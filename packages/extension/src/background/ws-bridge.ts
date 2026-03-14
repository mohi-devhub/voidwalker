// WebSocket client that connects to the Voidwalker MCP server.
// Handles authentication, exponential-backoff reconnection, and outbound message queuing
// so events are never dropped during transient disconnections.
import {
  WS_URL,
  MAX_QUEUE_SIZE,
  QUEUE_FLUSH_INTERVAL_MS,
  MAX_BUFFERED_AMOUNT,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  ALLOWED_ORIGINS_KEY,
  CONFIRM_WRITES_KEY,
} from "../shared/constants";
import { getToken } from "../shared/auth";

// ─── Domain allowlist ─────────────────────────────────────────────────────────
async function isOriginAllowed(origin: string | undefined): Promise<boolean> {
  if (!origin) return true;
  const result = await chrome.storage.local.get([ALLOWED_ORIGINS_KEY]);
  const list = (result[ALLOWED_ORIGINS_KEY] as string[] | undefined) ?? [];
  return list.length === 0 || list.includes(origin);
}

// ─── Write confirmation ───────────────────────────────────────────────────────
const pendingConfirms = new Map<string, (allowed: boolean) => void>();

chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  const resolve = pendingConfirms.get(notifId);
  if (resolve) {
    pendingConfirms.delete(notifId);
    chrome.notifications.clear(notifId);
    resolve(buttonIndex === 0); // 0 = Allow, 1 = Deny
  }
});

chrome.notifications.onClosed.addListener((notifId) => {
  const resolve = pendingConfirms.get(notifId);
  if (resolve) {
    pendingConfirms.delete(notifId);
    resolve(false);
  }
});

async function askConfirmation(action: string, detail: string): Promise<boolean> {
  const result = await chrome.storage.local.get([CONFIRM_WRITES_KEY]);
  if (!(result[CONFIRM_WRITES_KEY] as boolean | undefined)) return true;

  const notifId = `vw-confirm-${Date.now()}`;
  return new Promise<boolean>((resolve) => {
    pendingConfirms.set(notifId, resolve);
    chrome.notifications.create(notifId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon.png"),
      title: "Voidwalker — Write Request",
      message: `AI wants to ${action}: ${detail}`,
      buttons: [{ title: "Allow" }, { title: "Deny" }],
      requireInteraction: true,
    });
    setTimeout(() => {
      if (pendingConfirms.has(notifId)) {
        pendingConfirms.delete(notifId);
        chrome.notifications.clear(notifId);
        resolve(false);
      }
    }, 30_000);
  });
}

let ws: WebSocket | null = null;
let authenticated = false;
let seq = 0;
let retryDelay = RECONNECT_BASE_MS;
let reconnectPending = false;
let flushTimer: number | null = null;

// Outbound queue — holds serialised messages while disconnected or unauthenticated
const queue: string[] = [];

function nextSeq(): number {
  return seq++;
}

function flushQueue(): void {
  while (
    queue.length > 0 &&
    ws?.readyState === WebSocket.OPEN &&
    ws.bufferedAmount < MAX_BUFFERED_AMOUNT &&
    authenticated
  ) {
    ws.send(queue.shift()!);
  }
}

async function connect(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const token = await getToken();
  if (!token) {
    console.warn("[voidwalker] No auth token — paste the token from ~/.voidwalker/token via the extension popup.");
    scheduleReconnect();
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws!.send(
      JSON.stringify({
        type: "auth_hello",
        seq: nextSeq(),
        ts: Date.now(),
        token,
        extensionVersion: chrome.runtime.getManifest().version,
        browser: "chrome",
      }),
    );
  };

  ws.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg["type"] === "auth_ok") {
      authenticated = true;
      retryDelay = RECONNECT_BASE_MS; // reset backoff on successful auth
      flushQueue();
    } else if (msg["type"] === "auth_error") {
      console.error("[voidwalker] Auth rejected:", msg["reason"]);
      ws?.close();
    } else if (typeof msg["type"] === "string" && msg["type"].startsWith("cmd_")) {
      // Write commands: check allowlist + confirmation before dispatching
      const tabId = msg["tabId"] as number | undefined;
      const origin = msg["origin"] as string | undefined;
      const cmdType = msg["type"] as string;
      void (async () => {
        if (!(await isOriginAllowed(origin))) {
          console.warn("[voidwalker] Command blocked: origin not in allowlist", origin);
          return;
        }
        let action = "write";
        let detail = "";
        if (cmdType === "cmd_set_storage") {
          action = "set";
          detail = `${msg["storageType"]}.${msg["key"]} = "${msg["value"]}"`;
        } else if (cmdType === "cmd_delete_storage") {
          action = "delete";
          detail = `${msg["storageType"]}.${msg["key"]}`;
        } else if (cmdType === "cmd_delete_indexeddb") {
          action = "delete IndexedDB record";
          detail = `${msg["dbName"]}.${msg["storeName"]}[${msg["key"]}]`;
        } else if (cmdType === "cmd_navigate_tab") {
          action = "navigate to";
          detail = msg["url"] as string;
        }
        if (!(await askConfirmation(action, detail))) {
          console.log("[voidwalker] Write command denied by user");
          return;
        }
        if (cmdType === "cmd_navigate_tab" && tabId != null) {
          chrome.tabs.update(tabId, { url: msg["url"] as string }).catch(() => {});
        } else if (tabId != null) {
          chrome.tabs.sendMessage(tabId, msg).catch(() => {
            console.warn("[voidwalker] Could not relay command to tab", tabId);
          });
        }
      })();
    } else if (msg["type"] === "request_snapshot") {
      // Relay snapshot request to the target tab's content script
      const tabId = msg["tabId"] as number | undefined;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, msg).catch(() => {});
      }
    }
  };

  ws.onclose = (e) => {
    authenticated = false;
    // Code 4001 = bad token — don't retry, surface to user instead
    if (e.code !== 4001) scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose always fires after onerror; reconnection is handled there
  };
}

function scheduleReconnect(): void {
  if (reconnectPending) return;
  reconnectPending = true;
  setTimeout(() => {
    reconnectPending = false;
    void connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startBridge(): void {
  void connect();
  if (flushTimer === null) {
    flushTimer = setInterval(flushQueue, QUEUE_FLUSH_INTERVAL_MS) as unknown as number;
  }
}

export function sendMessage(msg: Record<string, unknown>): void {
  const line = JSON.stringify(msg);
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_AMOUNT && authenticated) {
    ws.send(line);
  } else {
    if (queue.length >= MAX_QUEUE_SIZE) queue.shift(); // drop oldest on overflow
    queue.push(line);
  }
}

export function ping(): void {
  sendMessage({ type: "ping", seq: nextSeq(), ts: Date.now() });
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN && authenticated;
}
