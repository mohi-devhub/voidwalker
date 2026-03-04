import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { StateStore } from "./state-store.js";
import type { ExtensionMessage } from "@voidwalker/shared";

const SERVER_VERSION = "0.0.1";

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function attachWebSocketServer(
  httpServer: HttpServer,
  stateStore: StateStore,
  token: string,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });
  let serverSeq = 0;

  wss.on("connection", (ws) => {
    let authenticated = false;

    // Extension must authenticate within 5 seconds
    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(4001, "Auth timeout");
    }, 5_000);

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        ws.close(4000, "Invalid JSON");
        return;
      }

      if (!authenticated) {
        if (msg["type"] !== "auth_hello" || msg["token"] !== token) {
          send(ws, { type: "auth_error", seq: serverSeq++, ts: Date.now(), reason: "Invalid token" });
          ws.close(4001, "Auth failed");
          return;
        }
        clearTimeout(authTimer);
        authenticated = true;
        send(ws, { type: "auth_ok", seq: serverSeq++, ts: Date.now(), serverVersion: SERVER_VERSION });
        process.stderr.write("[ws] Extension connected\n");
        return;
      }

      if (msg["type"] === "ping") {
        send(ws, { type: "pong", seq: serverSeq++, ts: Date.now() });
        return;
      }

      try {
        stateStore.applyMessage(msg as unknown as ExtensionMessage);
      } catch (err) {
        process.stderr.write(`[ws] applyMessage error: ${err}\n`);
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (authenticated) process.stderr.write("[ws] Extension disconnected\n");
    });

    ws.on("error", (err) => process.stderr.write(`[ws] Socket error: ${err}\n`));
  });

  return wss;
}
