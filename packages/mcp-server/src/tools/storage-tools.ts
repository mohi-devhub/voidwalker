import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { StateStore } from "../state-store.js";
import { getDomMutationsTool, handleGetDomMutations } from "./mutations-tool.js";
import {
  searchStorageTool, searchIndexedDBTool, decodeStorageValueTool, diffStorageTool,
  handleSearchStorage, handleSearchIndexedDB, handleDecodeStorageValue, handleDiffStorage,
} from "./read-tools.js";
import {
  setStorageTool, deleteStorageTool, deleteIndexedDBTool, requestSnapshotTool,
  clearServerStateTool, navigateTabTool,
  handleSetStorage, handleDeleteStorage, handleDeleteIndexedDB,
  handleRequestSnapshot, handleClearServerState, handleNavigateTab,
} from "./write-tools.js";

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
        const os = stateStore.getOriginState(tabId, origin);
        if (!os) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `No state for tab ${tabId} origin ${origin}` }) }],
            isError: true,
          };
        }
        const source = storageType === "localStorage" ? os.localStorage : os.sessionStorage;
        const entries = Object.fromEntries(source.entries);
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
        const truncated = records.length > limit;
        records = records.slice(0, limit);
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
        const os = stateStore.getOriginState(tabId, origin);
        const cookie = os?.cookies.entries.get(name);
        if (!cookie) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Cookie "${name}" not found for origin ${origin}` }) }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ tabId, origin, cookie }, null, 2) }],
        };
      }

      case "search_cookies": {
        const { tabId, origin, namePattern, valuePattern } = args as {
          tabId: number;
          origin: string;
          namePattern?: string;
          valuePattern?: string;
        };
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tabId, origin, cookies, cookieCount: cookies.length }, null, 2),
            },
          ],
        };
      }

      case "get_dom_mutations":
        return { content: [{ type: "text", text: handleGetDomMutations(stateStore, args as Record<string, unknown>) }] };
      case "search_storage":
        return { content: [{ type: "text", text: handleSearchStorage(stateStore, args as Record<string, unknown>) }] };
      case "search_indexeddb":
        return { content: [{ type: "text", text: handleSearchIndexedDB(stateStore, args as Record<string, unknown>) }] };
      case "decode_storage_value":
        return { content: [{ type: "text", text: handleDecodeStorageValue(stateStore, args as Record<string, unknown>) }] };
      case "diff_storage":
        return { content: [{ type: "text", text: handleDiffStorage(stateStore, args as Record<string, unknown>) }] };
      case "set_storage":
        return { content: [{ type: "text", text: handleSetStorage(stateStore, args as Record<string, unknown>) }] };
      case "delete_storage":
        return { content: [{ type: "text", text: handleDeleteStorage(stateStore, args as Record<string, unknown>) }] };
      case "delete_indexeddb":
        return { content: [{ type: "text", text: handleDeleteIndexedDB(stateStore, args as Record<string, unknown>) }] };
      case "request_snapshot":
        return { content: [{ type: "text", text: handleRequestSnapshot(stateStore, args as Record<string, unknown>) }] };
      case "clear_server_state":
        return { content: [{ type: "text", text: handleClearServerState(stateStore, args as Record<string, unknown>) }] };
      case "navigate_tab":
        return { content: [{ type: "text", text: handleNavigateTab(stateStore, args as Record<string, unknown>) }] };

      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  });
}
