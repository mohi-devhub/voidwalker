// ─── Foundation ──────────────────────────────────────────────────────────────

export interface BaseMessage {
  seq: number;   // Monotonic per-connection sequence number
  ts: number;    // Unix epoch ms (sender clock)
  type: string;
}

export interface EventMeta {
  tabId: number;
  origin: string; // e.g. "https://example.com"
  url: string;
  pageClock: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthHelloMessage extends BaseMessage {
  type: "auth_hello";
  token: string;
  extensionVersion: string;
  browser: "chrome" | "firefox" | "edge";
}

export interface AuthOkMessage extends BaseMessage {
  type: "auth_ok";
  serverVersion: string;
}

export interface AuthErrorMessage extends BaseMessage {
  type: "auth_error";
  reason: string;
}

// ─── Keep-alive ───────────────────────────────────────────────────────────────

export interface PingMessage extends BaseMessage {
  type: "ping";
}

export interface PongMessage extends BaseMessage {
  type: "pong";
}

// ─── LocalStorage ─────────────────────────────────────────────────────────────

export interface LocalStorageSetMessage extends BaseMessage {
  type: "localstorage_set";
  meta: EventMeta;
  key: string;
  value: string;
  oldValue: string | null;
}

export interface LocalStorageRemoveMessage extends BaseMessage {
  type: "localstorage_remove";
  meta: EventMeta;
  key: string;
  oldValue: string | null;
}

export interface LocalStorageClearMessage extends BaseMessage {
  type: "localstorage_clear";
  meta: EventMeta;
  previousState: Record<string, string>;
}

// ─── SessionStorage ───────────────────────────────────────────────────────────

export interface SessionStorageSetMessage extends BaseMessage {
  type: "sessionstorage_set";
  meta: EventMeta;
  key: string;
  value: string;
  oldValue: string | null;
}

export interface SessionStorageRemoveMessage extends BaseMessage {
  type: "sessionstorage_remove";
  meta: EventMeta;
  key: string;
  oldValue: string | null;
}

export interface SessionStorageClearMessage extends BaseMessage {
  type: "sessionstorage_clear";
  meta: EventMeta;
  previousState: Record<string, string>;
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

export type IDBSerialised = string; // JSON.stringify of actual value/key

export interface IndexedDBPutMessage extends BaseMessage {
  type: "indexeddb_put";
  meta: EventMeta;
  dbName: string;
  storeName: string;
  key: IDBSerialised;
  value: IDBSerialised;
}

export interface IndexedDBDeleteMessage extends BaseMessage {
  type: "indexeddb_delete";
  meta: EventMeta;
  dbName: string;
  storeName: string;
  key: IDBSerialised;
}

export interface IndexedDBClearMessage extends BaseMessage {
  type: "indexeddb_clear";
  meta: EventMeta;
  dbName: string;
  storeName: string;
}

export interface IndexedDBStoreCreatedMessage extends BaseMessage {
  type: "indexeddb_store_created";
  meta: EventMeta;
  dbName: string;
  storeName: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
}

// ─── Cookies ──────────────────────────────────────────────────────────────────

export interface SerializableCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "no_restriction" | "lax" | "strict" | "unspecified";
  expirationDate?: number;
  hostOnly: boolean;
  session: boolean;
}

export interface CookieSetMessage extends BaseMessage {
  type: "cookie_set";
  meta: { origin: string; url: string; tabId: number | null };
  cookie: SerializableCookie;
}

export interface CookieRemovedMessage extends BaseMessage {
  type: "cookie_removed";
  meta: { origin: string; url: string; tabId: number | null };
  cookie: SerializableCookie;
  cause: "explicit" | "overwrite" | "expired" | "expired_overwrite" | "evicted";
}

// ─── DOM Mutations ────────────────────────────────────────────────────────────

export interface DomMutationRecord {
  type: "childList" | "attributes" | "characterData";
  targetSelector: string;
  addedNodes: string[];    // outerHTML, trimmed to 2KB per node, max 20 nodes
  removedNodes: string[];
  attributeName: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface DomMutationMessage extends BaseMessage {
  type: "dom_mutation";
  meta: EventMeta;
  mutations: DomMutationRecord[];
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export interface SnapshotLocalStorageMessage extends BaseMessage {
  type: "snapshot_localstorage";
  meta: EventMeta;
  entries: Record<string, string>;
}

export interface SnapshotSessionStorageMessage extends BaseMessage {
  type: "snapshot_sessionstorage";
  meta: EventMeta;
  entries: Record<string, string>;
}

export interface SnapshotIndexedDBMessage extends BaseMessage {
  type: "snapshot_indexeddb";
  meta: EventMeta;
  dbName: string;
  version: number;
  stores: Array<{
    storeName: string;
    records: Array<{ key: IDBSerialised; value: IDBSerialised }>;
  }>;
}

// ─── Tab Lifecycle ────────────────────────────────────────────────────────────

export interface TabClosedMessage extends BaseMessage {
  type: "tab_closed";
  tabId: number;
}

export interface TabNavigatedMessage extends BaseMessage {
  type: "tab_navigated";
  tabId: number;
  newUrl: string;
  oldUrl: string;
}

export interface TabOpenedMessage extends BaseMessage {
  type: "tab_opened";
  tabId: number;
  url: string;
  title: string;
}

// ─── Discriminated Unions ─────────────────────────────────────────────────────

export type ExtensionMessage =
  | AuthHelloMessage
  | PingMessage
  | LocalStorageSetMessage
  | LocalStorageRemoveMessage
  | LocalStorageClearMessage
  | SessionStorageSetMessage
  | SessionStorageRemoveMessage
  | SessionStorageClearMessage
  | IndexedDBPutMessage
  | IndexedDBDeleteMessage
  | IndexedDBClearMessage
  | IndexedDBStoreCreatedMessage
  | CookieSetMessage
  | CookieRemovedMessage
  | DomMutationMessage
  | SnapshotLocalStorageMessage
  | SnapshotSessionStorageMessage
  | SnapshotIndexedDBMessage
  | TabClosedMessage
  | TabNavigatedMessage
  | TabOpenedMessage;

export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | PongMessage
  | {
      type: "request_snapshot";
      seq: number;
      ts: number;
      tabId: number;
      target: "localstorage" | "sessionstorage" | "indexeddb" | "cookies" | "all";
    };
