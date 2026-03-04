// WebSocket client that connects to the Voidwalker MCP server.
// Handles authentication, exponential-backoff reconnection, and outbound message queuing
// so events are never dropped during transient disconnections.
import {
  WS_URL,
  MAX_QUEUE_SIZE,
  QUEUE_FLUSH_INTERVAL_MS,
  MAX_BUFFERED_AMOUNT,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
} from "../shared/constants";
import { getToken } from "../shared/auth";

let ws: WebSocket | null = null;
let authenticated = false;
let seq = 0;
let retryDelay = RECONNECT_BASE_MS;
let reconnectPending = false;
let flushTimer: number | null = null;

// Outbound queue — holds serialised messages while disconnected or unauthenticated
const queue: string[] = [];

function nextSeq(): number {
  return seq++;
}

function flushQueue(): void {
  while (
    queue.length > 0 &&
    ws?.readyState === WebSocket.OPEN &&
    ws.bufferedAmount < MAX_BUFFERED_AMOUNT &&
    authenticated
  ) {
    ws.send(queue.shift()!);
  }
}

async function connect(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const token = await getToken();
  if (!token) {
    console.warn("[voidwalker] No auth token — paste the token from ~/.voidwalker/token via the extension popup.");
    scheduleReconnect();
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws!.send(
      JSON.stringify({
        type: "auth_hello",
        seq: nextSeq(),
        ts: Date.now(),
        token,
        extensionVersion: chrome.runtime.getManifest().version,
        browser: "chrome",
      }),
    );
  };

  ws.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg["type"] === "auth_ok") {
      authenticated = true;
      retryDelay = RECONNECT_BASE_MS; // reset backoff on successful auth
      flushQueue();
    } else if (msg["type"] === "auth_error") {
      console.error("[voidwalker] Auth rejected:", msg["reason"]);
      ws?.close();
    }
  };

  ws.onclose = (e) => {
    authenticated = false;
    // Code 4001 = bad token — don't retry, surface to user instead
    if (e.code !== 4001) scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose always fires after onerror; reconnection is handled there
  };
}

function scheduleReconnect(): void {
  if (reconnectPending) return;
  reconnectPending = true;
  setTimeout(() => {
    reconnectPending = false;
    void connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startBridge(): void {
  void connect();
  if (flushTimer === null) {
    flushTimer = setInterval(flushQueue, QUEUE_FLUSH_INTERVAL_MS) as unknown as number;
  }
}

export function sendMessage(msg: Record<string, unknown>): void {
  const line = JSON.stringify(msg);
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_AMOUNT && authenticated) {
    ws.send(line);
  } else {
    if (queue.length >= MAX_QUEUE_SIZE) queue.shift(); // drop oldest on overflow
    queue.push(line);
  }
}

export function ping(): void {
  sendMessage({ type: "ping", seq: nextSeq(), ts: Date.now() });
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN && authenticated;
}
