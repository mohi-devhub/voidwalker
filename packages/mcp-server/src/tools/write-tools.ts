// Write-action tools: send commands to the connected extension and/or mutate server state.
import type { StateStore } from "../state-store.js";
import { sendCommand } from "../websocket.js";

let cmdSeq = 0;
function nextSeq(): number { return cmdSeq++; }

// ── Tool definitions ──────────────────────────────────────────────────────────

export const setStorageTool = {
  name: "set_storage",
  description:
    "Write a key-value pair to localStorage or sessionStorage in the browser tab. The change is executed in the live page and will be visible in DevTools immediately.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      storageType: {
        type: "string",
        enum: ["localStorage", "sessionStorage"],
        description: "Which storage to write",
      },
      key: { type: "string", description: "Storage key" },
      value: { type: "string", description: "Storage value (string)" },
    },
    required: ["tabId", "origin", "storageType", "key", "value"],
  },
};

export const deleteStorageTool = {
  name: "delete_storage",
  description:
    "Delete a key from localStorage or sessionStorage in the browser tab.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      storageType: {
        type: "string",
        enum: ["localStorage", "sessionStorage"],
        description: "Which storage to delete from",
      },
      key: { type: "string", description: "Storage key to remove" },
    },
    required: ["tabId", "origin", "storageType", "key"],
  },
};

export const deleteIndexedDBTool = {
  name: "delete_indexeddb",
  description:
    "Delete a record from an IndexedDB object store in the browser tab.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      dbName: { type: "string", description: "IndexedDB database name" },
      storeName: { type: "string", description: "Object store name" },
      key: { type: "string", description: "JSON-serialized key of the record to delete" },
    },
    required: ["tabId", "origin", "dbName", "storeName", "key"],
  },
};

export const requestSnapshotTool = {
  name: "request_snapshot",
  description:
    "Ask the extension to re-send a full storage snapshot for a tab. Use this to refresh state after a page interaction.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      target: {
        type: "string",
        enum: ["localstorage", "sessionstorage", "indexeddb", "cookies", "all"],
        description: "Which storage to snapshot (default: all)",
      },
    },
    required: ["tabId"],
  },
};

export const clearServerStateTool = {
  name: "clear_server_state",
  description:
    "Clear in-memory state on the MCP server for a specific tab, origin, or everything. Does not affect the browser.",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["tab", "origin", "all"],
        description: "What to clear",
      },
      tabId: { type: "number", description: "Tab ID (required when scope is tab or origin)" },
      origin: { type: "string", description: "Origin (required when scope is origin)" },
    },
    required: ["scope"],
  },
};

export const navigateTabTool = {
  name: "navigate_tab",
  description: "Navigate a browser tab to a new URL.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      url: { type: "string", description: "Destination URL" },
    },
    required: ["tabId", "url"],
  },
};

// ── Handlers ──────────────────────────────────────────────────────────────────

function noExtension(): string {
  return JSON.stringify({ error: "No extension connected. Load the Voidwalker extension and ensure it is authenticated." });
}

export function handleSetStorage(_stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, storageType, key, value } = args as {
    tabId: number; origin: string; storageType: "localStorage" | "sessionStorage"; key: string; value: string;
  };
  const sent = sendCommand({ type: "cmd_set_storage", seq: nextSeq(), ts: Date.now(), tabId, origin, storageType, key, value });
  if (!sent) return noExtension();
  return JSON.stringify({ ok: true, tabId, origin, storageType, key, value });
}

export function handleDeleteStorage(_stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, storageType, key } = args as {
    tabId: number; origin: string; storageType: "localStorage" | "sessionStorage"; key: string;
  };
  const sent = sendCommand({ type: "cmd_delete_storage", seq: nextSeq(), ts: Date.now(), tabId, origin, storageType, key });
  if (!sent) return noExtension();
  return JSON.stringify({ ok: true, tabId, origin, storageType, key });
}

export function handleDeleteIndexedDB(_stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, dbName, storeName, key } = args as {
    tabId: number; origin: string; dbName: string; storeName: string; key: string;
  };
  const sent = sendCommand({ type: "cmd_delete_indexeddb", seq: nextSeq(), ts: Date.now(), tabId, origin, dbName, storeName, key });
  if (!sent) return noExtension();
  return JSON.stringify({ ok: true, tabId, origin, dbName, storeName, key });
}

export function handleRequestSnapshot(_stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, target = "all" } = args as { tabId: number; target?: string };
  const sent = sendCommand({ type: "request_snapshot", seq: nextSeq(), ts: Date.now(), tabId, target });
  if (!sent) return noExtension();
  return JSON.stringify({ ok: true, tabId, target, note: "Snapshot will arrive asynchronously; re-read the resource in a moment." });
}

export function handleClearServerState(stateStore: StateStore, args: Record<string, unknown>): string {
  const { scope, tabId, origin } = args as { scope: "tab" | "origin" | "all"; tabId?: number; origin?: string };
  if (scope === "all") {
    stateStore.clearAll();
    return JSON.stringify({ ok: true, cleared: "all" });
  }
  if (scope === "tab") {
    if (tabId == null) return JSON.stringify({ error: "tabId required for scope=tab" });
    stateStore.clearTab(tabId);
    return JSON.stringify({ ok: true, cleared: "tab", tabId });
  }
  if (scope === "origin") {
    if (tabId == null || !origin) return JSON.stringify({ error: "tabId and origin required for scope=origin" });
    stateStore.clearOrigin(tabId, origin);
    return JSON.stringify({ ok: true, cleared: "origin", tabId, origin });
  }
  return JSON.stringify({ error: `Unknown scope: ${scope}` });
}

export function handleNavigateTab(_stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, url } = args as { tabId: number; url: string };
  const sent = sendCommand({ type: "cmd_navigate_tab", seq: nextSeq(), ts: Date.now(), tabId, url });
  if (!sent) return noExtension();
  return JSON.stringify({ ok: true, tabId, url });
}
