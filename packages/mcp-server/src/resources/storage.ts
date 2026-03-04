import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { StateStore } from "../state-store.js";

// Matches: browser://tabs/{tabId}/origins/{encodedOrigin}/localstorage
const LS_URI_RE = /^browser:\/\/tabs\/(\d+)\/origins\/([^/]+)\/localstorage$/;

export function registerStorageResources(server: Server, stateStore: StateStore): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const dynamic = [];
    for (const tab of stateStore.getAllTabs()) {
      for (const [, os] of tab.byOrigin) {
        dynamic.push({
          uri: `browser://tabs/${tab.tabId}/origins/${encodeURIComponent(os.origin)}/localstorage`,
          name: `localStorage · ${os.origin} (tab ${tab.tabId})`,
          description: `localStorage entries for origin ${os.origin} in tab ${tab.tabId}`,
          mimeType: "application/json",
        });
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
    const m = LS_URI_RE.exec(uri);
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
              {
                tabId,
                origin,
                entries,
                entryCount: Object.keys(entries).length,
                lastUpdated: os?.localStorage.lastUpdated ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  });
}
