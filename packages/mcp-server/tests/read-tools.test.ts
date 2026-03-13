import { describe, it, expect, beforeEach } from "vitest";
import { StateStore } from "../src/state-store.js";
import {
  handleSearchStorage,
  handleSearchIndexedDB,
  handleDecodeStorageValue,
  handleDiffStorage,
} from "../src/tools/read-tools.js";

const base = { seq: 0, ts: Date.now() };
const meta = {
  tabId: 1,
  origin: "https://example.com",
  url: "https://example.com/",
  pageClock: Date.now(),
};

function makeStore(): StateStore {
  const store = new StateStore();
  store.applyMessage({ ...base, type: "localstorage_set", meta, key: "authToken", value: "Bearer abc123", oldValue: null });
  store.applyMessage({ ...base, type: "localstorage_set", meta, key: "theme", value: "dark", oldValue: null });
  store.applyMessage({ ...base, type: "sessionstorage_set", meta, key: "sessionId", value: "sess-xyz", oldValue: null });
  store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "appdb", storeName: "users", key: '"u1"', value: '{"id":1,"name":"Alice"}' });
  store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "appdb", storeName: "users", key: '"u2"', value: '{"id":2,"name":"Bob"}' });
  return store;
}

// ── handleSearchStorage ───────────────────────────────────────────────────────

describe("handleSearchStorage", () => {
  let store: StateStore;
  beforeEach(() => { store = makeStore(); });

  it("finds by keyPattern (case-insensitive)", () => {
    const result = JSON.parse(handleSearchStorage(store, { tabId: 1, origin: "https://example.com", keyPattern: "token" }));
    expect(result.resultCount).toBe(1);
    expect(result.results[0].key).toBe("authToken");
  });

  it("finds by valuePattern (case-insensitive)", () => {
    const result = JSON.parse(handleSearchStorage(store, { tabId: 1, origin: "https://example.com", valuePattern: "dark" }));
    expect(result.resultCount).toBe(1);
    expect(result.results[0].key).toBe("theme");
  });

  it("searches both storage types by default", () => {
    const result = JSON.parse(handleSearchStorage(store, { tabId: 1, origin: "https://example.com", keyPattern: "session" }));
    expect(result.resultCount).toBe(1);
    expect(result.results[0].storageType).toBe("sessionStorage");
  });

  it("restricts to localStorage when specified", () => {
    const result = JSON.parse(handleSearchStorage(store, {
      tabId: 1,
      origin: "https://example.com",
      storageType: "localStorage",
      keyPattern: "session",
    }));
    expect(result.resultCount).toBe(0);
  });

  it("returns error JSON when origin not found", () => {
    const result = JSON.parse(handleSearchStorage(store, { tabId: 99, origin: "https://unknown.com" }));
    expect(result.error).toBeDefined();
  });
});

// ── handleSearchIndexedDB ─────────────────────────────────────────────────────

describe("handleSearchIndexedDB", () => {
  let store: StateStore;
  beforeEach(() => { store = makeStore(); });

  it("finds records matching valuePattern", () => {
    const result = JSON.parse(handleSearchIndexedDB(store, {
      tabId: 1,
      origin: "https://example.com",
      dbName: "appdb",
      valuePattern: "Alice",
    }));
    expect(result.resultCount).toBe(1);
    expect(result.results[0].key).toBe('"u1"');
  });

  it("restricts to storeName when provided", () => {
    const result = JSON.parse(handleSearchIndexedDB(store, {
      tabId: 1,
      origin: "https://example.com",
      dbName: "appdb",
      storeName: "users",
      valuePattern: "Bob",
    }));
    expect(result.resultCount).toBe(1);
    expect(result.results[0].key).toBe('"u2"');
  });

  it("respects limit", () => {
    const result = JSON.parse(handleSearchIndexedDB(store, {
      tabId: 1,
      origin: "https://example.com",
      dbName: "appdb",
      valuePattern: "id",
      limit: 1,
    }));
    expect(result.results.length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("returns error JSON when db not found", () => {
    const result = JSON.parse(handleSearchIndexedDB(store, {
      tabId: 1,
      origin: "https://example.com",
      dbName: "nonexistent",
      valuePattern: "x",
    }));
    expect(result.error).toBeDefined();
  });
});

// ── handleDecodeStorageValue ──────────────────────────────────────────────────

describe("handleDecodeStorageValue", () => {
  it("returns raw for a plain string", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "plain", value: "hello", oldValue: null });
    const result = JSON.parse(handleDecodeStorageValue(store, { tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "plain" }));
    expect(result.interpretations.raw).toBe("hello");
  });

  it("parses valid JSON", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "obj", value: '{"x":1}', oldValue: null });
    const result = JSON.parse(handleDecodeStorageValue(store, { tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "obj" }));
    expect(result.interpretations.json).toEqual({ x: 1 });
  });

  it("decodes valid base64 ASCII text", () => {
    const store = new StateStore();
    const b64 = Buffer.from("hello world").toString("base64");
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "b64", value: b64, oldValue: null });
    const result = JSON.parse(handleDecodeStorageValue(store, { tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "b64" }));
    expect(result.interpretations.base64).toBe("hello world");
  });

  it("decodes a JWT into header and payload", () => {
    const store = new StateStore();
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user1" })).toString("base64url");
    const jwt = `${header}.${payload}.fakesig`;
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "jwt", value: jwt, oldValue: null });
    const result = JSON.parse(handleDecodeStorageValue(store, { tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "jwt" }));
    expect(result.interpretations.jwt.header.alg).toBe("HS256");
    expect(result.interpretations.jwt.payload.sub).toBe("user1");
  });

  it("returns error JSON when key not found", () => {
    const store = new StateStore();
    const result = JSON.parse(handleDecodeStorageValue(store, { tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "missing" }));
    expect(result.error).toBeDefined();
  });
});

// ── handleDiffStorage ─────────────────────────────────────────────────────────

describe("handleDiffStorage", () => {
  it("identifies added, removed, changed, and unchanged keys", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "kept", value: "same", oldValue: null });
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "modified", value: "new-value", oldValue: null });
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "added", value: "brand-new", oldValue: null });

    const baseline = { kept: "same", modified: "old-value", removed: "gone" };
    const result = JSON.parse(handleDiffStorage(store, {
      tabId: 1,
      origin: "https://example.com",
      storageType: "localStorage",
      baseline,
    }));

    expect(result.added).toHaveProperty("added");
    expect(result.removed).toHaveProperty("removed");
    expect(result.changed.some((c: { key: string }) => c.key === "modified")).toBe(true);
    expect(result.unchangedCount).toBe(1);
    expect(result.summary.addedCount).toBe(1);
    expect(result.summary.removedCount).toBe(1);
    expect(result.summary.changedCount).toBe(1);
  });

  it("returns empty diff when current and baseline match", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "k", value: "v", oldValue: null });
    const result = JSON.parse(handleDiffStorage(store, {
      tabId: 1,
      origin: "https://example.com",
      storageType: "localStorage",
      baseline: { k: "v" },
    }));
    expect(result.summary.addedCount).toBe(0);
    expect(result.summary.removedCount).toBe(0);
    expect(result.summary.changedCount).toBe(0);
    expect(result.unchangedCount).toBe(1);
  });
});
