import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StateStore } from "./state-store.js";
import { registerStorageResources } from "./resources/storage.js";
import { registerStorageTools } from "./tools/storage-tools.js";

export function createMcpServer(stateStore: StateStore): Server {
  const server = new Server(
    { name: "voidwalker", version: "0.0.1" },
    { capabilities: { resources: {}, tools: {} } },
  );

  registerStorageResources(server, stateStore);
  registerStorageTools(server, stateStore);

  return server;
}
