import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { StateStore } from "../state-store.js";
import {
  EVENTS_URI_RE,
  ORIGIN_EVENTS_URI_RE,
  readTabEvents,
  readOriginEvents,
  mutationResourceEntries,
} from "./mutations.js";

// URI patterns
const LS_URI_RE = /^browser:\/\/tabs\/(\d+)\/origins\/([^/]+)\/localstorage$/;
const SS_URI_RE = /^browser:\/\/tabs\/(\d+)\/origins\/([^/]+)\/sessionstorage$/;
const IDB_URI_RE = /^browser:\/\/tabs\/(\d+)\/origins\/([^/]+)\/indexeddb$/;
const COOKIES_URI_RE = /^browser:\/\/tabs\/(\d+)\/origins\/([^/]+)\/cookies$/;

export function registerStorageResources(server: Server, stateStore: StateStore): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const dynamic = [];
    for (const tab of stateStore.getAllTabs()) {
      for (const [, os] of tab.byOrigin) {
        const enc = encodeURIComponent(os.origin);
        const base = `browser://tabs/${tab.tabId}/origins/${enc}`;
        dynamic.push(
          {
            uri: `${base}/localstorage`,
            name: `localStorage · ${os.origin} (tab ${tab.tabId})`,
            description: `localStorage entries for origin ${os.origin} in tab ${tab.tabId}`,
            mimeType: "application/json",
          },
          {
            uri: `${base}/sessionstorage`,
            name: `sessionStorage · ${os.origin} (tab ${tab.tabId})`,
            description: `sessionStorage entries for origin ${os.origin} in tab ${tab.tabId}`,
            mimeType: "application/json",
          },
          {
            uri: `${base}/indexeddb`,
            name: `IndexedDB · ${os.origin} (tab ${tab.tabId})`,
            description: `IndexedDB databases and records for origin ${os.origin} in tab ${tab.tabId}`,
            mimeType: "application/json",
          },
          {
            uri: `${base}/cookies`,
            name: `Cookies · ${os.origin} (tab ${tab.tabId})`,
            description: `Cookies for origin ${os.origin} in tab ${tab.tabId}`,
            mimeType: "application/json",
          },
          ...mutationResourceEntries(tab.tabId, os.origin),
        );
      }
    }
    return {
      resources: [
        {
          uri: "browser://tabs",
          name: "Browser Tabs",
          description: "All active browser tabs with metadata",
          mimeType: "application/json",
        },
        ...dynamic,
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;

    // browser://tabs — list all tabs
    if (uri === "browser://tabs") {
      const tabs = stateStore.getAllTabs().map((t) => ({
        tabId: t.tabId,
        url: t.url,
        origins: Array.from(t.byOrigin.keys()),
        firstSeen: t.firstSeen,
        lastActivity: t.lastActivity,
      }));
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ tabs, totalTabs: tabs.length }, null, 2),
          },
        ],
      };
    }

    // browser://tabs/{tabId}/origins/{origin}/localstorage
    let m = LS_URI_RE.exec(uri);
    if (m) {
      const tabId = parseInt(m[1]!, 10);
      const origin = decodeURIComponent(m[2]!);
      const os = stateStore.getOriginState(tabId, origin);
      const entries = os ? Object.fromEntries(os.localStorage.entries) : {};
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              { tabId, origin, entries, entryCount: Object.keys(entries).length, lastUpdated: os?.localStorage.lastUpdated ?? null },
              null,
              2,
            ),
          },
        ],
      };
    }

    // browser://tabs/{tabId}/origins/{origin}/sessionstorage
    m = SS_URI_RE.exec(uri);
    if (m) {
      const tabId = parseInt(m[1]!, 10);
      const origin = decodeURIComponent(m[2]!);
      const os = stateStore.getOriginState(tabId, origin);
      const entries = os ? Object.fromEntries(os.sessionStorage.entries) : {};
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              { tabId, origin, entries, entryCount: Object.keys(entries).length, lastUpdated: os?.sessionStorage.lastUpdated ?? null },
              null,
              2,
            ),
          },
        ],
      };
    }

    // browser://tabs/{tabId}/origins/{origin}/indexeddb
    m = IDB_URI_RE.exec(uri);
    if (m) {
      const tabId = parseInt(m[1]!, 10);
      const origin = decodeURIComponent(m[2]!);
      const os = stateStore.getOriginState(tabId, origin);
      const databases: Record<string, unknown> = {};
      if (os) {
        for (const [dbName, db] of os.indexedDB) {
          const stores: Record<string, unknown> = {};
          for (const [storeName, store] of db.stores) {
            stores[storeName] = {
              records: Object.fromEntries(store.records),
              recordCount: store.records.size,
              lastUpdated: store.lastUpdated,
            };
          }
          databases[dbName] = { stores, lastUpdated: db.lastUpdated };
        }
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ tabId, origin, databases }, null, 2),
          },
        ],
      };
    }

    // browser://tabs/{tabId}/origins/{origin}/cookies
    m = COOKIES_URI_RE.exec(uri);
    if (m) {
      const tabId = parseInt(m[1]!, 10);
      const origin = decodeURIComponent(m[2]!);
      const os = stateStore.getOriginState(tabId, origin);
      const cookies = os ? Array.from(os.cookies.entries.values()) : [];
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              { tabId, origin, cookies, cookieCount: cookies.length, lastUpdated: os?.cookies.lastUpdated ?? null },
              null,
              2,
            ),
          },
        ],
      };
    }

    // browser://tabs/{tabId}/events
    let em = EVENTS_URI_RE.exec(uri);
    if (em) {
      const tabId = parseInt(em[1]!, 10);
      return {
        contents: [{ uri, mimeType: "application/json", text: readTabEvents(stateStore, tabId, uri) }],
      };
    }

    // browser://tabs/{tabId}/origins/{origin}/events
    em = ORIGIN_EVENTS_URI_RE.exec(uri);
    if (em) {
      const tabId = parseInt(em[1]!, 10);
      const origin = decodeURIComponent(em[2]!);
      return {
        contents: [{ uri, mimeType: "application/json", text: readOriginEvents(stateStore, tabId, origin, uri) }],
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  });
}
