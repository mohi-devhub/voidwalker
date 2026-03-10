// MV3 service worker — coordinates the WebSocket bridge, alarm-based keepalive,
// tab lifecycle tracking, and message relay from content scripts.
import { ALARM_NAME, ALARM_PERIOD_MINUTES } from "../shared/constants";
import { startBridge, sendMessage, ping } from "./ws-bridge";
import { startCookieMonitor } from "./cookie-monitor";

let msgSeq = 0;
function nextSeq(): number {
  return msgSeq++;
}

// Connect to MCP server on startup
startBridge();
startCookieMonitor();

// ─── Alarm-based keepalive ────────────────────────────────────────────────────
// Chrome terminates MV3 service workers after 30s of inactivity.
// A 25-second alarm keeps the event loop active and doubles as a WebSocket heartbeat.
chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    startBridge(); // idempotent — reconnects only if currently disconnected
    ping();
  }
});

// ─── Content script message relay ─────────────────────────────────────────────
// Content scripts cannot self-identify their tab; we read it from sender.tab.id
// and attach it to message.meta before forwarding over WebSocket.
chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, sender) => {
    if (sender.tab?.id != null) {
      const meta = message["meta"] as Record<string, unknown> | undefined;
      if (meta != null) meta["tabId"] = sender.tab.id;
    }
    sendMessage({ ...message, seq: nextSeq(), ts: Date.now() });
    return false; // synchronous — no async response needed
  },
);

// ─── Tab lifecycle ────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  sendMessage({ type: "tab_closed", tabId, seq: nextSeq(), ts: Date.now() });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url != null) {
    sendMessage({
      type: "tab_navigated",
      tabId,
      newUrl: changeInfo.url,
      oldUrl: tab.url ?? "",
      seq: nextSeq(),
      ts: Date.now(),
    });
  }
});
