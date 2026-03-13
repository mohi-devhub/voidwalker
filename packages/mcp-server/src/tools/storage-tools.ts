import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { StateStore } from "../state-store.js";
import { getDomMutationsTool, handleGetDomMutations } from "./mutations-tool.js";
import {
  searchStorageTool, searchIndexedDBTool, decodeStorageValueTool, diffStorageTool,
  getStorageHistoryTool,
  handleSearchStorage, handleSearchIndexedDB, handleDecodeStorageValue, handleDiffStorage,
  handleGetStorageHistory,
} from "./read-tools.js";
import {
  setStorageTool, deleteStorageTool, deleteIndexedDBTool, requestSnapshotTool,
  clearServerStateTool, navigateTabTool,
  handleSetStorage, handleDeleteStorage, handleDeleteIndexedDB,
  handleRequestSnapshot, handleClearServerState, handleNavigateTab,
} from "./write-tools.js";
import { logActivity } from "../utils/activity-log.js";
import { redactEntries, redactValue } from "../utils/redact.js";
import { MAX_QUERY_LIMIT } from "@voidwalker/shared";

export function registerStorageTools(server: Server, stateStore: StateStore): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "read_storage",
        description:
          "Read localStorage or sessionStorage entries for a specific tab and origin. Returns all key-value pairs.",
        inputSchema: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "Browser tab ID" },
            origin: { type: "string", description: "Origin, e.g. https://example.com" },
            storageType: {
              type: "string",
              enum: ["localStorage", "sessionStorage"],
              description: "Which storage to read",
            },
          },
          required: ["tabId", "origin", "storageType"],
        },
      },
      {
        name: "query_indexeddb",
        description:
          "Query records from an IndexedDB object store for a specific tab and origin. Optionally filter by key prefix.",
        inputSchema: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "Browser tab ID" },
            origin: { type: "string", description: "Origin, e.g. https://example.com" },
            dbName: { type: "string", description: "IndexedDB database name" },
            storeName: { type: "string", description: "Object store name" },
            keyPrefix: {
              type: "string",
              description: "Optional JSON-serialized key prefix to filter records",
            },
            limit: {
              type: "number",
              description: "Maximum number of records to return (default 100)",
            },
          },
          required: ["tabId", "origin", "dbName", "storeName"],
        },
      },
      {
        name: "get_cookie",
        description: "Get a specific cookie by name for an origin.",
        inputSchema: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "Browser tab ID" },
            origin: { type: "string", description: "Origin, e.g. https://example.com" },
            name: { type: "string", description: "Cookie name" },
          },
          required: ["tabId", "origin", "name"],
        },
      },
      {
        name: "search_cookies",
        description:
          "Search cookies for an origin by name or value pattern. Returns all matching cookies.",
        inputSchema: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "Browser tab ID" },
            origin: { type: "string", description: "Origin, e.g. https://example.com" },
            namePattern: {
              type: "string",
              description: "Substring to match against cookie name (case-insensitive)",
            },
            valuePattern: {
              type: "string",
              description: "Substring to match against cookie value (case-insensitive)",
            },
          },
          required: ["tabId", "origin"],
        },
      },
      getDomMutationsTool,
      searchStorageTool,
      searchIndexedDBTool,
      decodeStorageValueTool,
      diffStorageTool,
      getStorageHistoryTool,
      setStorageTool,
      deleteStorageTool,
      deleteIndexedDBTool,
      requestSnapshotTool,
      clearServerStateTool,
      navigateTabTool,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    switch (name) {
      case "read_storage": {
        const { tabId, origin, storageType } = args as {
          tabId: number;
          origin: string;
          storageType: "localStorage" | "sessionStorage";
        };
        logActivity("read", "read_storage", { tabId, origin, storageType });
        const os = stateStore.getOriginState(tabId, origin);
        if (!os) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `No state for tab ${tabId} origin ${origin}` }) }],
            isError: true,
          };
        }
        const source = storageType === "localStorage" ? os.localStorage : os.sessionStorage;
        const entries = redactEntries(Object.fromEntries(source.entries));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { tabId, origin, storageType, entries, entryCount: Object.keys(entries).length, lastUpdated: source.lastUpdated },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "query_indexeddb": {
        logActivity("read", "query_indexeddb", args as Record<string, unknown>);
        const { tabId, origin, dbName, storeName, keyPrefix, limit = 100 } = args as {
          tabId: number;
          origin: string;
          dbName: string;
          storeName: string;
          keyPrefix?: string;
          limit?: number;
        };
        const os = stateStore.getOriginState(tabId, origin);
        const db = os?.indexedDB.get(dbName);
        const store = db?.stores.get(storeName);
        if (!store) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Store "${storeName}" in db "${dbName}" not found` }) }],
            isError: true,
          };
        }
        let records = Array.from(store.records.entries()).map(([k, v]) => ({
          key: k,
          value: v,
        }));
        if (keyPrefix) {
          records = records.filter(({ key }) => key.startsWith(keyPrefix));
        }
        const effectiveLimit = Math.min(Math.max(1, limit), MAX_QUERY_LIMIT);
        const truncated = records.length > effectiveLimit;
        records = records.slice(0, effectiveLimit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { tabId, origin, dbName, storeName, records, recordCount: records.length, truncated, lastUpdated: store.lastUpdated },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_cookie": {
        const { tabId, origin, name } = args as { tabId: number; origin: string; name: string };
        logActivity("read", "get_cookie", { tabId, origin, name });
        const os = stateStore.getOriginState(tabId, origin);
        const cookie = os?.cookies.entries.get(name);
        if (!cookie) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Cookie "${name}" not found for origin ${origin}` }) }],
            isError: true,
          };
        }
        const redactedCookie = { ...cookie, value: redactValue(cookie.name, cookie.value) };
        return {
          content: [{ type: "text", text: JSON.stringify({ tabId, origin, cookie: redactedCookie }, null, 2) }],
        };
      }

      case "search_cookies": {
        const { tabId, origin, namePattern, valuePattern } = args as {
          tabId: number;
          origin: string;
          namePattern?: string;
          valuePattern?: string;
        };
        logActivity("read", "search_cookies", { tabId, origin, namePattern, valuePattern });
        const os = stateStore.getOriginState(tabId, origin);
        let cookies = os ? Array.from(os.cookies.entries.values()) : [];
        if (namePattern) {
          const lc = namePattern.toLowerCase();
          cookies = cookies.filter((c) => c.name.toLowerCase().includes(lc));
        }
        if (valuePattern) {
          const lc = valuePattern.toLowerCase();
          cookies = cookies.filter((c) => c.value.toLowerCase().includes(lc));
        }
        const redactedCookies = cookies.map((c) => ({ ...c, value: redactValue(c.name, c.value) }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tabId, origin, cookies: redactedCookies, cookieCount: redactedCookies.length }, null, 2),
            },
          ],
        };
      }

      case "get_dom_mutations":
        logActivity("read", "get_dom_mutations", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleGetDomMutations(stateStore, args as Record<string, unknown>) }] };
      case "search_storage":
        logActivity("read", "search_storage", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleSearchStorage(stateStore, args as Record<string, unknown>) }] };
      case "search_indexeddb":
        logActivity("read", "search_indexeddb", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleSearchIndexedDB(stateStore, args as Record<string, unknown>) }] };
      case "decode_storage_value":
        logActivity("read", "decode_storage_value", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleDecodeStorageValue(stateStore, args as Record<string, unknown>) }] };
      case "diff_storage":
        logActivity("read", "diff_storage", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleDiffStorage(stateStore, args as Record<string, unknown>) }] };
      case "get_storage_history":
        logActivity("read", "get_storage_history", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleGetStorageHistory(stateStore, args as Record<string, unknown>) }] };
      case "set_storage":
        logActivity("write", "set_storage", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleSetStorage(stateStore, args as Record<string, unknown>) }] };
      case "delete_storage":
        logActivity("write", "delete_storage", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleDeleteStorage(stateStore, args as Record<string, unknown>) }] };
      case "delete_indexeddb":
        logActivity("write", "delete_indexeddb", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleDeleteIndexedDB(stateStore, args as Record<string, unknown>) }] };
      case "request_snapshot":
        logActivity("admin", "request_snapshot", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleRequestSnapshot(stateStore, args as Record<string, unknown>) }] };
      case "clear_server_state":
        logActivity("admin", "clear_server_state", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleClearServerState(stateStore, args as Record<string, unknown>) }] };
      case "navigate_tab":
        logActivity("write", "navigate_tab", args as Record<string, unknown>);
        return { content: [{ type: "text", text: handleNavigateTab(stateStore, args as Record<string, unknown>) }] };

      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  });
}
