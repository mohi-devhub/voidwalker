// Runs in the ISOLATED world.
// Relays window.postMessage events from page-script.ts (MAIN world) to the service worker,
// and sends an initial localStorage snapshot on injection.
import { MESSAGE_PREFIX } from "../shared/constants";

// ─── Relay MAIN → background ──────────────────────────────────────────────────
window.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
  if (!event.data?.[MESSAGE_PREFIX]) return;

  // Strip the internal marker before forwarding — it's not part of the wire protocol
  const { [MESSAGE_PREFIX]: _marker, ...msg } = event.data;
  chrome.runtime.sendMessage(msg).catch(() => {
    // Background service worker may not be ready on the very first injection
  });
});

// ─── Initial snapshot ─────────────────────────────────────────────────────────
// Send current localStorage contents so the MCP server has state even for pages
// that never call setItem after the extension connects.
const entries: Record<string, string> = {};
for (let i = 0; i < localStorage.length; i++) {
  const k = localStorage.key(i)!;
  entries[k] = localStorage.getItem(k)!;
}

chrome.runtime
  .sendMessage({
    type: "snapshot_localstorage",
    // tabId is intentionally absent here — the service worker reads it from sender.tab.id
    meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
    entries,
  })
  .catch(() => {});
