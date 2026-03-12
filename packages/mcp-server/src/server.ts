import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { StateStore } from "./state-store.js";
import { registerStorageResources } from "./resources/storage.js";
import { registerStorageTools } from "./tools/storage-tools.js";

export function createMcpServer(stateStore: StateStore): Server {
  const server = new Server(
    { name: "voidwalker", version: "0.0.1" },
    { capabilities: { resources: { subscribe: true, listChanged: true }, tools: {} } },
  );

  registerStorageResources(server, stateStore);
  registerStorageTools(server, stateStore);

  // We broadcast updates to all connected clients, so subscribe/unsubscribe are no-ops.
  server.setRequestHandler(SubscribeRequestSchema, async () => ({}));
  server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}));

  return server;
}

/**
 * Wire StateStore events to MCP resource notifications for a connected server.
 * Returns a cleanup function to remove the listeners (call when the transport closes).
 */
export function attachStateListeners(server: Server, stateStore: StateStore): () => void {
  const onOriginUpdated = (tabId: number, origin: string) => {
    const enc = encodeURIComponent(origin);
    const base = `browser://tabs/${tabId}/origins/${enc}`;
    const uris = [
      `${base}/localstorage`,
      `${base}/sessionstorage`,
      `${base}/indexeddb`,
      `${base}/cookies`,
      `${base}/events`,
      `browser://tabs/${tabId}/events`,
      "browser://events/global",
      "browser://tabs",
    ];
    for (const uri of uris) {
      server.sendResourceUpdated({ uri }).catch(() => {});
    }
  };

  const onListChanged = () => {
    server.sendResourceListChanged().catch(() => {});
  };

  stateStore.on("origin_updated", onOriginUpdated);
  stateStore.on("tab_removed", onListChanged);
  stateStore.on("all_cleared", onListChanged);

  return () => {
    stateStore.off("origin_updated", onOriginUpdated);
    stateStore.off("tab_removed", onListChanged);
    stateStore.off("all_cleared", onListChanged);
  };
}
