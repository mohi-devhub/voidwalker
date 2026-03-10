import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { StateStore } from "../state-store.js";

export function registerMutationTools(server: Server, stateStore: StateStore): void {
  // ListTools is already registered in storage-tools.ts; we extend it there.
  // This module only registers the CallTool handler for get_dom_mutations.
  // See server.ts for the consolidated ListTools registration.
  void stateStore; // used via CallTool dispatch in storage-tools.ts
}

/** Returns the get_dom_mutations tool definition (merged into the ListTools response). */
export const getDomMutationsTool = {
  name: "get_dom_mutations",
  description:
    "Retrieve recent DOM mutation events for a tab and origin. Returns batched records from the in-memory circular buffer (last 500 entries).",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: {
        type: "string",
        description: "Origin, e.g. https://example.com. Omit to get mutations across all origins for the tab.",
      },
      limit: {
        type: "number",
        description: "Max number of mutation batches to return (default 50)",
      },
      mutationType: {
        type: "string",
        enum: ["childList", "attributes", "characterData"],
        description: "Filter by mutation type (optional)",
      },
    },
    required: ["tabId"],
  },
};

export function handleGetDomMutations(
  stateStore: StateStore,
  args: Record<string, unknown>,
): string {
  const { tabId, origin, limit = 50, mutationType } = args as {
    tabId: number;
    origin?: string;
    limit?: number;
    mutationType?: "childList" | "attributes" | "characterData";
  };

  const tab = stateStore.getTab(tabId);
  if (!tab) {
    return JSON.stringify({ error: `No state for tab ${tabId}` });
  }

  type StoredEntry = { origin: string; ts: string; url: string; mutations: unknown[] };
  let entries: StoredEntry[] = [];

  const originKeys = origin ? [origin] : Array.from(tab.byOrigin.keys());
  for (const key of originKeys) {
    const os = tab.byOrigin.get(key);
    if (!os) continue;
    for (const entry of os.mutations.toArray()) {
      entries.push({ origin: key, ...entry });
    }
  }

  // Sort chronologically
  entries.sort((a, b) => a.ts.localeCompare(b.ts));

  // Filter by mutation type if requested
  if (mutationType) {
    entries = entries.map((e) => ({
      ...e,
      mutations: (e.mutations as Array<{ type: string }>).filter((m) => m.type === mutationType),
    })).filter((e) => e.mutations.length > 0);
  }

  const truncated = entries.length > (limit as number);
  entries = entries.slice(-(limit as number)); // take most recent N

  return JSON.stringify(
    { tabId, origin: origin ?? null, entries, entryCount: entries.length, truncated },
    null,
    2,
  );
}
