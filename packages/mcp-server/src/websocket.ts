import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { StateStore } from "./state-store.js";
import type { ExtensionMessage } from "@voidwalker/shared";
import { MAX_PAYLOAD_BYTES } from "@voidwalker/shared";

const SERVER_VERSION = "1.0.0";

// Track the currently authenticated extension connection (one at a time)
let activeSocket: WebSocket | null = null;

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Prevents runaway processes from hammering the server with connection attempts.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CONNS = 10;
const connAttempts = new Map<string, number[]>(); // IP → timestamps within current window

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

  wss.on("connection", (ws, req) => {
    // ── Rate limiting ──────────────────────────────────────────────────────────
    const ip = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const recent = (connAttempts.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    recent.push(now);
    connAttempts.set(ip, recent);
    if (recent.length > RATE_MAX_CONNS) {
      ws.close(4029, "Rate limit exceeded");
      return;
    }

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
        // Evict any existing connection — only one extension allowed at a time
        if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
          activeSocket.close(4000, "Replaced by new connection");
        }
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
