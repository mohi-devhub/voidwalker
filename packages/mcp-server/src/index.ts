#!/usr/bin/env node
import { createServer } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_PORT, RETENTION_MS } from "@voidwalker/shared";
import { StateStore } from "./state-store.js";
import { attachWebSocketServer } from "./websocket.js";
import { createMcpServer, attachStateListeners } from "./server.js";
import { loadOrCreateToken } from "./utils/token.js";

const port = parseInt(process.env["VOIDWALKER_PORT"] ?? String(DEFAULT_PORT), 10);

async function main(): Promise<void> {
  const token = loadOrCreateToken();
  const stateStore = new StateStore();

  // GC stale tabs every 60 seconds (tabs inactive > RETENTION_MS are removed)
  setInterval(() => stateStore.collectStale(RETENTION_MS), 60_000).unref();

  // Track SSE transports for POST message routing (one entry per connected MCP client)
  const sseTransports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    // MCP SSE transport — Gemini CLI and other SSE-based MCP clients connect here
    if (req.method === "GET" && url.pathname === "/sse") {
      if (url.searchParams.get("token") !== token) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", "null"); // restrict to non-browser or same-origin only
      const transport = new SSEServerTransport("/message", res);
      sseTransports.set(transport.sessionId, transport);
      const srv = createMcpServer(stateStore);
      const cleanup = attachStateListeners(srv, stateStore);
      res.on("close", () => {
        cleanup();
        sseTransports.delete(transport.sessionId);
      });
      await srv.connect(transport);
      return;
    }

    // Client → server messages for an existing SSE session
    if (req.method === "POST" && url.pathname === "/message") {
      const sid = url.searchParams.get("sessionId") ?? "";
      const transport = sseTransports.get(sid);
      if (!transport) {
        res.writeHead(404);
        res.end("Unknown session");
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // WebSocket server for browser extension connections (shares the HTTP server port)
  attachWebSocketServer(httpServer, stateStore, token);

  httpServer.listen(port, "127.0.0.1", () => {
    process.stderr.write(
      `Voidwalker MCP server running | WS on ws://127.0.0.1:${port} | SSE on http://127.0.0.1:${port}/sse\n`,
    );
  });

  // Stdio transport for Claude Desktop / Claude Code
  const stdioSrv = createMcpServer(stateStore);
  attachStateListeners(stdioSrv, stateStore);
  const stdioTransport = new StdioServerTransport();
  await stdioSrv.connect(stdioTransport);
}

main().catch((err) => {
  process.stderr.write(`[voidwalker] Fatal: ${err}\n`);
  process.exit(1);
});
