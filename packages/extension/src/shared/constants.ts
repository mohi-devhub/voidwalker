export const WS_PORT = 3695;
export const WS_URL = `ws://127.0.0.1:${WS_PORT}`;

export const ALARM_NAME = "keepalive";
export const ALARM_PERIOD_MINUTES = 25 / 60; // fires every 25 seconds

export const MAX_QUEUE_SIZE = 1_000;
export const QUEUE_FLUSH_INTERVAL_MS = 16; // ~60fps drain cycle
export const MAX_BUFFERED_AMOUNT = 65_536; // 64KB — back-pressure threshold

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export const TOKEN_KEY = "voidwalker_token";
export const MESSAGE_PREFIX = "__voidwalker";
export const ALLOWED_ORIGINS_KEY = "voidwalker_allowed_origins";
export const CONFIRM_WRITES_KEY = "voidwalker_confirm_writes";
