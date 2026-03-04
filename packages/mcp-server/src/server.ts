import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StateStore } from "./state-store.js";
import { registerStorageResources } from "./resources/storage.js";

export function createMcpServer(stateStore: StateStore): Server {
  const server = new Server(
    { name: "voidwalker", version: "0.0.1" },
    { capabilities: { resources: {} } },
  );

  registerStorageResources(server, stateStore);

  return server;
}
