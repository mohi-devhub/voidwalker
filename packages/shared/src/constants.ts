export const DEFAULT_PORT = 3695;
export const WS_HOST = "127.0.0.1";
export const WS_URL = `ws://${WS_HOST}:${DEFAULT_PORT}`;

export const PING_INTERVAL_MS = 20_000;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export const EVENT_BUFFER_MAX = 1_000;
export const MUTATION_RING_SIZE = 500;
export const CHANGELOG_RING_SIZE = 1_000;
export const RETENTION_MS = 5 * 60 * 1_000;

export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const MESSAGE_PREFIX = "__voidwalker__";
export const TOKEN_PATH = `${process.env["HOME"] ?? "~"}/.voidwalker/token`;
