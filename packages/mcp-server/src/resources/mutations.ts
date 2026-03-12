// Helper functions for reading DOM mutation event data.
// URI handling is integrated into storage.ts since the MCP SDK only supports
// one ReadResource handler per server instance.
import type { StateStore } from "../state-store.js";

export const GLOBAL_EVENTS_URI = "browser://events/global";
export const GLOBAL_EVENTS_URI_RE = /^browser:\/\/events\/global$/;

export const EVENTS_URI_RE = /^browser:\/\/tabs\/(\d+)\/events$/;
export const ORIGIN_EVENTS_URI_RE = /^browser:\/\/tabs\/(\d+)\/origins\/([^/]+)\/events$/;

export function readTabEvents(stateStore: StateStore, tabId: number, uri: string): string {
  const tab = stateStore.getTab(tabId);
  const events: unknown[] = [];
  if (tab) {
    for (const [, os] of tab.byOrigin) {
      for (const entry of os.mutations.toArray()) {
        events.push({ origin: os.origin, ...entry });
      }
    }
    (events as Array<{ ts: string }>).sort((a, b) => a.ts.localeCompare(b.ts));
  }
  return JSON.stringify({ tabId, events, eventCount: events.length }, null, 2);
}

export function readOriginEvents(
  stateStore: StateStore,
  tabId: number,
  origin: string,
  uri: string,
): string {
  const os = stateStore.getOriginState(tabId, origin);
  const events = os ? os.mutations.toArray() : [];
  return JSON.stringify({ tabId, origin, events, eventCount: events.length }, null, 2);
}

export function readGlobalEvents(stateStore: StateStore): string {
  const events: Array<{ tabId: number; origin: string; ts: string; url: string; mutations: unknown[] }> = [];
  for (const tab of stateStore.getAllTabs()) {
    for (const [origin, os] of tab.byOrigin) {
      for (const m of os.mutations.toArray()) {
        events.push({ tabId: tab.tabId, origin, ...m });
      }
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return JSON.stringify({ events, total: events.length }, null, 2);
}

/** Returns event resource descriptors for a given tab+origin, for use in ListResources. */
export function mutationResourceEntries(
  tabId: number,
  origin: string,
): Array<{ uri: string; name: string; description: string; mimeType: string }> {
  const enc = encodeURIComponent(origin);
  return [
    {
      uri: `browser://tabs/${tabId}/events`,
      name: `DOM Events · tab ${tabId}`,
      description: `All DOM mutation events for tab ${tabId} across all origins`,
      mimeType: "application/json",
    },
    {
      uri: `browser://tabs/${tabId}/origins/${enc}/events`,
      name: `DOM Events · ${origin} (tab ${tabId})`,
      description: `DOM mutation events for origin ${origin} in tab ${tabId}`,
      mimeType: "application/json",
    },
  ];
}
