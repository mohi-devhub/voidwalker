// Firefox MV2 event page — mirrors service-worker.ts.
// Event pages are unloaded when idle and wake on browser events, so no
// special service-worker keepalive tricks are needed beyond the alarm.
import { ALARM_NAME, ALARM_PERIOD_MINUTES } from "../shared/constants";
import { startBridge, sendMessage, ping, isConnected } from "./ws-bridge";
import { startCookieMonitor } from "./cookie-monitor";

let msgSeq = 0;
function nextSeq(): number {
  return msgSeq++;
}

// ─── Event throughput tracking ────────────────────────────────────────────────
let eventCountWindow = 0;
let eventsPerSec = 0;
setInterval(() => {
  eventsPerSec = eventCountWindow;
  eventCountWindow = 0;
}, 1_000);

startBridge();
startCookieMonitor();

// ─── Keepalive alarm (doubles as WS heartbeat) ────────────────────────────────
chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    startBridge(); // idempotent
    ping();
  }
});

// ─── Content script message relay ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, sender, sendResponse) => {
    if (message["type"] === "get_status") {
      sendResponse({ connected: isConnected(), eventsPerSec, tabCount: 0 });
      return false;
    }

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
    return false;
  },
);

// ─── Incoming write commands from MCP server ──────────────────────────────────
chrome.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  if (message["type"] === "cmd_navigate_tab") {
    const tabId = message["tabId"] as number;
    const url = message["url"] as string;
    chrome.tabs.update(tabId, { url }).catch(() => {});
  }
  return false;
});

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
