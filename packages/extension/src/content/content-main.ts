// Runs in the ISOLATED world.
// Relays window.postMessage events from page-script.ts (MAIN world) to the service worker,
// sends initial storage snapshots on injection, and observes DOM mutations.
import { MESSAGE_PREFIX } from "../shared/constants";
import { isFirefox } from "../shared/platform";

// ─── Firefox: inject page-script into MAIN world ──────────────────────────────
// Chrome uses world: "MAIN" in manifest.json, which Firefox MV2 doesn't support.
// We inject page-script.js as a <script> element so it runs in the page's JS context.
if (isFirefox) {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("content/page-script.js");
  (document.head ?? document.documentElement).prepend(script);
  script.addEventListener("load", () => script.remove(), { once: true });
}

// ─── Incoming write commands from service worker ──────────────────────────────
// The background relays cmd_* and request_snapshot messages here via chrome.tabs.sendMessage.
chrome.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  const type = message["type"] as string | undefined;

  if (type === "cmd_set_storage") {
    const { storageType, key, value } = message as {
      storageType: "localStorage" | "sessionStorage";
      key: string;
      value: string;
    };
    const store = storageType === "localStorage" ? localStorage : sessionStorage;
    store.setItem(key, value);
  } else if (type === "cmd_delete_storage") {
    const { storageType, key } = message as {
      storageType: "localStorage" | "sessionStorage";
      key: string;
    };
    const store = storageType === "localStorage" ? localStorage : sessionStorage;
    store.removeItem(key);
  } else if (type === "cmd_delete_indexeddb") {
    const { dbName, storeName, key } = message as {
      dbName: string;
      storeName: string;
      key: string;
    };
    const parsedKey = JSON.parse(key) as IDBValidKey;
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(parsedKey);
      tx.oncomplete = () => db.close();
    };
  } else if (type === "request_snapshot") {
    const target = (message["target"] as string) ?? "all";
    const snap = (t: string) => {
      if (t === "localstorage" || t === "all") {
        const entries: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          entries[k] = localStorage.getItem(k)!;
        }
        chrome.runtime.sendMessage({
          type: "snapshot_localstorage",
          meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
          entries,
        }).catch(() => {});
      }
      if (t === "sessionstorage" || t === "all") {
        const entries: Record<string, string> = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i)!;
          entries[k] = sessionStorage.getItem(k)!;
        }
        chrome.runtime.sendMessage({
          type: "snapshot_sessionstorage",
          meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
          entries,
        }).catch(() => {});
      }
    };
    snap(target);
  }

  return false;
});

// ─── Relay MAIN → background ──────────────────────────────────────────────────
window.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data?.[MESSAGE_PREFIX]) return;

  // Strip the internal marker before forwarding — it's not part of the wire protocol
  const { [MESSAGE_PREFIX]: _marker, ...msg } = event.data;
  chrome.runtime.sendMessage(msg).catch(() => {
    // Background service worker may not be ready on the very first injection
  });
});

// ─── Initial snapshots ────────────────────────────────────────────────────────
// Send current storage contents so the MCP server has state even for pages
// that never call setItem after the extension connects.
// tabId is intentionally absent — the service worker reads it from sender.tab.id.

const lsEntries: Record<string, string> = {};
for (let i = 0; i < localStorage.length; i++) {
  const k = localStorage.key(i)!;
  lsEntries[k] = localStorage.getItem(k)!;
}
chrome.runtime
  .sendMessage({
    type: "snapshot_localstorage",
    meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
    entries: lsEntries,
  })
  .catch(() => {});

const ssEntries: Record<string, string> = {};
for (let i = 0; i < sessionStorage.length; i++) {
  const k = sessionStorage.key(i)!;
  ssEntries[k] = sessionStorage.getItem(k)!;
}
chrome.runtime
  .sendMessage({
    type: "snapshot_sessionstorage",
    meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
    entries: ssEntries,
  })
  .catch(() => {});

// ─── DOM Mutation Observer ────────────────────────────────────────────────────
// Batches MutationObserver records and forwards them to the service worker at
// most once every FLUSH_INTERVAL_MS to avoid flooding the WebSocket.

const FLUSH_INTERVAL_MS = 200;
const MAX_NODES_PER_RECORD = 20;
const MAX_NODE_HTML_BYTES = 2048;

function truncateHtml(html: string): string {
  return html.length > MAX_NODE_HTML_BYTES ? html.slice(0, MAX_NODE_HTML_BYTES) + "…" : html;
}

function selectorFor(el: Element): string {
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    let seg = node.localName;
    if (node.id) { seg = `#${node.id}`; parts.unshift(seg); break; }
    if (node.className) seg += `.${Array.from(node.classList).slice(0, 2).join(".")}`;
    parts.unshift(seg);
    node = node.parentElement;
  }
  return parts.join(" > ") || el.localName;
}

let pendingMutations: MutationRecord[] = [];
let flushHandle: ReturnType<typeof setTimeout> | null = null;

function flushMutations(): void {
  flushHandle = null;
  if (pendingMutations.length === 0) return;

  const batch = pendingMutations.splice(0);
  const records = batch.map((r) => {
    const addedNodes = Array.from(r.addedNodes)
      .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
      .slice(0, MAX_NODES_PER_RECORD)
      .map((n) => truncateHtml((n as Element).outerHTML));

    const removedNodes = Array.from(r.removedNodes)
      .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
      .slice(0, MAX_NODES_PER_RECORD)
      .map((n) => truncateHtml((n as Element).outerHTML));

    return {
      type: r.type as "childList" | "attributes" | "characterData",
      targetSelector: r.target instanceof Element ? selectorFor(r.target) : r.target.nodeName,
      addedNodes,
      removedNodes,
      attributeName: r.attributeName ?? null,
      oldValue: r.oldValue ?? null,
      newValue:
        r.type === "attributes" && r.target instanceof Element
          ? r.target.getAttribute(r.attributeName ?? "") ?? null
          : r.type === "characterData"
            ? (r.target as CharacterData).data
            : null,
    };
  });

  chrome.runtime
    .sendMessage({
      type: "dom_mutation",
      meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
      mutations: records,
    })
    .catch(() => {});
}

const observer = new MutationObserver((records) => {
  pendingMutations.push(...records);
  if (flushHandle === null) {
    flushHandle = setTimeout(flushMutations, FLUSH_INTERVAL_MS);
  }
});

// Start observing once the body is available
function startObserver(): void {
  const target = document.body ?? document.documentElement;
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
  });
}

if (document.body) {
  startObserver();
} else {
  document.addEventListener("DOMContentLoaded", startObserver, { once: true });
}
