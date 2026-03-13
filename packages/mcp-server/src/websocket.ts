import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { StateStore } from "./state-store.js";
import type { ExtensionMessage } from "@voidwalker/shared";
import { MAX_PAYLOAD_BYTES } from "@voidwalker/shared";

const SERVER_VERSION = "0.0.1";

// Track the currently authenticated extension connection (one at a time)
let activeSocket: WebSocket | null = null;

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Send a command to the connected extension. Returns false if no extension is connected. */
export function sendCommand(msg: Record<string, unknown>): boolean {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return false;
  activeSocket.send(JSON.stringify(msg));
  return true;
}

export function attachWebSocketServer(
  httpServer: HttpServer,
  stateStore: StateStore,
  token: string,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });
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
        activeSocket = ws;
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
      if (authenticated) {
        if (activeSocket === ws) activeSocket = null;
        process.stderr.write("[ws] Extension disconnected\n");
      }
    });

    ws.on("error", (err) => process.stderr.write(`[ws] Socket error: ${err}\n`));
  });

  return wss;
}
