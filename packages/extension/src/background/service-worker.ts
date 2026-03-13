// MV3 service worker — coordinates the WebSocket bridge, alarm-based keepalive,
// tab lifecycle tracking, and message relay from content scripts.
import { ALARM_NAME, ALARM_PERIOD_MINUTES } from "../shared/constants";
import { startBridge, sendMessage, ping, isConnected } from "./ws-bridge";
import { startCookieMonitor } from "./cookie-monitor";

let msgSeq = 0;
function nextSeq(): number {
  return msgSeq++;
}

// ─── Event throughput tracking ────────────────────────────────────────────────
let eventCountWindow = 0; // events in the current 1-second window
let eventsPerSec = 0;
setInterval(() => {
  eventsPerSec = eventCountWindow;
  eventCountWindow = 0;
}, 1_000);

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
  (message: Record<string, unknown>, sender, sendResponse) => {
    // Popup status query
    if (message["type"] === "get_status") {
      const tabCount = 0; // tabs are tracked server-side; return 0 as a safe default
      sendResponse({ connected: isConnected(), eventsPerSec, tabCount });
      return false;
    }

    // Reconnect request from popup (e.g. after token update)
    if (message["type"] === "reconnect") {
      startBridge();
      sendResponse({});
      return false;
    }

    if (sender.tab?.id != null) {
      const meta = message["meta"] as Record<string, unknown> | undefined;
      if (meta != null) meta["tabId"] = sender.tab.id;
    }
    eventCountWindow++;
    sendMessage({ ...message, seq: nextSeq(), ts: Date.now() });
    return false; // synchronous — no async response needed
  },
);

// ─── Incoming write commands from MCP server ──────────────────────────────────
// cmd_navigate_tab is handled here; storage write commands are relayed to content scripts.
chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>) => {
    if (message["type"] === "cmd_navigate_tab") {
      const tabId = message["tabId"] as number;
      const url = message["url"] as string;
      chrome.tabs.update(tabId, { url }).catch(() => {});
    }
    return false;
  },
);

// ─── Tab lifecycle ────────────────────────────────────────────────────────────
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id == null) return;
  sendMessage({ type: "tab_opened", tabId: tab.id, url: tab.url ?? tab.pendingUrl ?? "", title: tab.title ?? "", seq: nextSeq(), ts: Date.now() });
});

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
