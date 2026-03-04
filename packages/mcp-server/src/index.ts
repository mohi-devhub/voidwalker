import { createServer } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_PORT } from "@voidwalker/shared";
import { StateStore } from "./state-store.js";
import { attachWebSocketServer } from "./websocket.js";
import { createMcpServer } from "./server.js";
import { loadOrCreateToken } from "./utils/token.js";

const port = parseInt(process.env["VOIDWALKER_PORT"] ?? String(DEFAULT_PORT), 10);

async function main(): Promise<void> {
  const token = loadOrCreateToken();
  const stateStore = new StateStore();

  // Track SSE transports for POST message routing (one entry per connected MCP client)
  const sseTransports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    // MCP SSE transport — Gemini CLI and other SSE-based MCP clients connect here
    if (req.method === "GET" && url.pathname === "/sse") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const transport = new SSEServerTransport("/message", res);
      sseTransports.set(transport.sessionId, transport);
      res.on("close", () => sseTransports.delete(transport.sessionId));
      const srv = createMcpServer(stateStore);
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
  const stdioTransport = new StdioServerTransport();
  await stdioSrv.connect(stdioTransport);
}

main().catch((err) => {
  process.stderr.write(`[voidwalker] Fatal: ${err}\n`);
  process.exit(1);
});
