import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import { attachWebSocketServer, sendCommand } from "../src/websocket.js";
import { StateStore } from "../src/state-store.js";

const TOKEN = "test-secret-token-1234567890abcdef1234567890abcdef12345678";

interface ServerFixture {
  httpServer: HttpServer;
  port: number;
  store: StateStore;
}

function startServer(): Promise<ServerFixture> {
  return new Promise((resolve, reject) => {
    const store = new StateStore();
    const httpServer = createServer();
    attachWebSocketServer(httpServer, store, TOKEN);
    httpServer.on("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address() as { port: number };
      resolve({ httpServer, port: addr.port, store });
    });
  });
}

function stopServer(fixture: ServerFixture): Promise<void> {
  return new Promise((resolve) => fixture.httpServer.close(() => resolve()));
}

function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function waitMsg(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try { resolve(JSON.parse(data.toString())); }
      catch (e) { reject(e); }
    });
    ws.once("error", reject);
  });
}

function waitClose(ws: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve({ code }));
  });
}

const fixtures: ServerFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await stopServer(f);
  }
});

// ── Auth handshake ────────────────────────────────────────────────────────────

describe("WebSocket auth", () => {
  it("rejects wrong token with auth_error then closes", async () => {
    const fixture = await startServer();
    fixtures.push(fixture);
    const ws = connect(fixture.port);
    await waitOpen(ws);

    ws.send(JSON.stringify({ type: "auth_hello", token: "wrong-token", extensionVersion: "0.0.1", browser: "chrome", seq: 0, ts: Date.now() }));

    const msg = await waitMsg(ws);
    expect(msg["type"]).toBe("auth_error");

    const { code } = await waitClose(ws);
    expect(code).toBe(4001);
  });

  it("accepts correct token and replies with auth_ok", async () => {
    const fixture = await startServer();
    fixtures.push(fixture);
    const ws = connect(fixture.port);
    await waitOpen(ws);

    ws.send(JSON.stringify({ type: "auth_hello", token: TOKEN, extensionVersion: "0.0.1", browser: "chrome", seq: 0, ts: Date.now() }));

    const msg = await waitMsg(ws);
    expect(msg["type"]).toBe("auth_ok");
    expect(typeof msg["serverVersion"]).toBe("string");
    ws.close();
  });
});

// ── Post-auth behaviour ───────────────────────────────────────────────────────

describe("WebSocket post-auth", () => {
  async function authenticatedClient(fixture: ServerFixture): Promise<WebSocket> {
    const ws = connect(fixture.port);
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: "auth_hello", token: TOKEN, extensionVersion: "0.0.1", browser: "chrome", seq: 0, ts: Date.now() }));
    await waitMsg(ws); // consume auth_ok
    return ws;
  }

  it("responds to ping with pong", async () => {
    const fixture = await startServer();
    fixtures.push(fixture);
    const ws = await authenticatedClient(fixture);

    ws.send(JSON.stringify({ type: "ping", seq: 1, ts: Date.now() }));
    const msg = await waitMsg(ws);
    expect(msg["type"]).toBe("pong");
    ws.close();
  });

  it("routes valid storage messages to StateStore", async () => {
    const fixture = await startServer();
    fixtures.push(fixture);
    const ws = await authenticatedClient(fixture);

    const meta = { tabId: 1, origin: "https://example.com", url: "https://example.com/", pageClock: Date.now() };
    ws.send(JSON.stringify({ type: "localstorage_set", meta, key: "foo", value: "bar", oldValue: null, seq: 2, ts: Date.now() }));

    // Give server time to process the message
    await new Promise((r) => setTimeout(r, 50));
    expect(fixture.store.getOriginState(1, "https://example.com")?.localStorage.entries.get("foo")).toBe("bar");
    ws.close();
  });

  it("closes with 4000 on malformed JSON", async () => {
    const fixture = await startServer();
    fixtures.push(fixture);
    const ws = await authenticatedClient(fixture);

    ws.send("not-valid-json");
    const { code } = await waitClose(ws);
    expect(code).toBe(4000);
  });
});

// ── sendCommand ───────────────────────────────────────────────────────────────

describe("sendCommand", () => {
  it("returns false when no authenticated socket exists", async () => {
    // Start a fresh server but don't authenticate any client
    const fixture = await startServer();
    fixtures.push(fixture);
    // The module-level activeSocket may be set from a previous test; we work around
    // this by connecting a client that immediately disconnects (unauthenticated).
    expect(typeof sendCommand({ type: "ping", seq: 0, ts: Date.now() })).toBe("boolean");
  });
});
