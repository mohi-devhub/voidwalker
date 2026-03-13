import { describe, it, expect } from "vitest";
import { StateStore, CircularBuffer } from "../src/state-store.js";

// ── CircularBuffer ────────────────────────────────────────────────────────────

describe("CircularBuffer", () => {
  it("pushes items and retrieves in insertion order", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.size).toBe(3);
  });

  it("overwrites oldest entry when at capacity", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.toArray()).toEqual([2, 3, 4]);
    expect(buf.size).toBe(3);
  });

  it("returns oldest-first when buffer has wrapped multiple times", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    buf.push(40);
    buf.push(50);
    expect(buf.toArray()).toEqual([30, 40, 50]);
  });

  it("clear resets size and contents", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const base = { seq: 0, ts: Date.now() };
const meta = {
  tabId: 1,
  origin: "https://example.com",
  url: "https://example.com/page",
  pageClock: Date.now(),
};

// ── StateStore – LocalStorage ─────────────────────────────────────────────────

describe("StateStore – localStorage", () => {
  it("localstorage_set populates entries", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "foo", value: "bar", oldValue: null });
    expect(store.getOriginState(1, "https://example.com")?.localStorage.entries.get("foo")).toBe("bar");
  });

  it("localstorage_remove deletes key", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "foo", value: "bar", oldValue: null });
    store.applyMessage({ ...base, type: "localstorage_remove", meta, key: "foo", oldValue: "bar" });
    expect(store.getOriginState(1, "https://example.com")?.localStorage.entries.has("foo")).toBe(false);
  });

  it("localstorage_clear empties the map", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "foo", value: "bar", oldValue: null });
    store.applyMessage({ ...base, type: "localstorage_clear", meta, previousState: { foo: "bar" } });
    expect(store.getOriginState(1, "https://example.com")?.localStorage.entries.size).toBe(0);
  });

  it("snapshot_localstorage replaces entire map", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "old", value: "x", oldValue: null });
    store.applyMessage({ ...base, type: "snapshot_localstorage", meta, entries: { a: "1", b: "2" } });
    const ls = store.getOriginState(1, "https://example.com")?.localStorage;
    expect(ls?.entries.has("old")).toBe(false);
    expect(ls?.entries.get("a")).toBe("1");
    expect(ls?.entries.get("b")).toBe("2");
  });
});

// ── StateStore – SessionStorage ───────────────────────────────────────────────

describe("StateStore – sessionStorage", () => {
  it("set, remove, clear, snapshot mirror localStorage behaviour", () => {
    const store = new StateStore();

    store.applyMessage({ ...base, type: "sessionstorage_set", meta, key: "k", value: "v", oldValue: null });
    expect(store.getOriginState(1, "https://example.com")?.sessionStorage.entries.get("k")).toBe("v");

    store.applyMessage({ ...base, type: "sessionstorage_remove", meta, key: "k", oldValue: "v" });
    expect(store.getOriginState(1, "https://example.com")?.sessionStorage.entries.has("k")).toBe(false);

    store.applyMessage({ ...base, type: "sessionstorage_set", meta, key: "k2", value: "v2", oldValue: null });
    store.applyMessage({ ...base, type: "sessionstorage_clear", meta, previousState: { k2: "v2" } });
    expect(store.getOriginState(1, "https://example.com")?.sessionStorage.entries.size).toBe(0);

    store.applyMessage({ ...base, type: "snapshot_sessionstorage", meta, entries: { x: "y" } });
    expect(store.getOriginState(1, "https://example.com")?.sessionStorage.entries.get("x")).toBe("y");
  });
});

// ── StateStore – IndexedDB ────────────────────────────────────────────────────

describe("StateStore – indexedDB", () => {
  it("indexeddb_put populates nested store", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "mydb", storeName: "items", key: '"key1"', value: '"val1"' });
    const records = store.getOriginState(1, "https://example.com")?.indexedDB.get("mydb")?.stores.get("items")?.records;
    expect(records?.get('"key1"')).toBe('"val1"');
  });

  it("indexeddb_delete removes key", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "mydb", storeName: "items", key: '"k"', value: '"v"' });
    store.applyMessage({ ...base, type: "indexeddb_delete", meta, dbName: "mydb", storeName: "items", key: '"k"' });
    expect(store.getOriginState(1, "https://example.com")?.indexedDB.get("mydb")?.stores.get("items")?.records.has('"k"')).toBe(false);
  });

  it("indexeddb_clear empties store records", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "mydb", storeName: "items", key: '"k"', value: '"v"' });
    store.applyMessage({ ...base, type: "indexeddb_clear", meta, dbName: "mydb", storeName: "items" });
    expect(store.getOriginState(1, "https://example.com")?.indexedDB.get("mydb")?.stores.get("items")?.records.size).toBe(0);
  });

  it("indexeddb_store_created ensures store without overwriting existing records", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "mydb", storeName: "items", key: '"k"', value: '"v"' });
    store.applyMessage({ ...base, type: "indexeddb_store_created", meta, dbName: "mydb", storeName: "items", keyPath: "id", autoIncrement: false });
    expect(store.getOriginState(1, "https://example.com")?.indexedDB.get("mydb")?.stores.get("items")?.records.get('"k"')).toBe('"v"');
  });

  it("snapshot_indexeddb replaces records for the given db", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "indexeddb_put", meta, dbName: "mydb", storeName: "items", key: '"old"', value: '"x"' });
    store.applyMessage({
      ...base,
      type: "snapshot_indexeddb",
      meta,
      dbName: "mydb",
      version: 1,
      stores: [{ storeName: "items", records: [{ key: '"new"', value: '"y"' }] }],
    });
    const storeState = store.getOriginState(1, "https://example.com")?.indexedDB.get("mydb")?.stores.get("items");
    expect(storeState?.records.has('"old"')).toBe(false);
    expect(storeState?.records.get('"new"')).toBe('"y"');
  });
});

// ── StateStore – Cookies ──────────────────────────────────────────────────────

describe("StateStore – cookies", () => {
  const cookieMeta = { origin: "https://example.com", url: "https://example.com/", tabId: 1 };
  const cookie = {
    name: "session",
    value: "abc",
    domain: "example.com",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "strict" as const,
    hostOnly: true,
    session: true,
  };

  it("cookie_set populates entries", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "cookie_set", meta: cookieMeta, cookie });
    expect(store.getOriginState(1, "https://example.com")?.cookies.entries.get("session")?.value).toBe("abc");
  });

  it("cookie_removed deletes entry", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "cookie_set", meta: cookieMeta, cookie });
    store.applyMessage({ ...base, type: "cookie_removed", meta: cookieMeta, cookie, cause: "explicit" });
    expect(store.getOriginState(1, "https://example.com")?.cookies.entries.has("session")).toBe(false);
  });
});

// ── StateStore – DOM Mutations ────────────────────────────────────────────────

describe("StateStore – dom_mutation", () => {
  it("pushes mutation to ring buffer", () => {
    const store = new StateStore();
    const mutation = {
      type: "childList" as const,
      targetSelector: "body",
      addedNodes: [],
      removedNodes: [],
      attributeName: null,
      oldValue: null,
      newValue: null,
    };
    store.applyMessage({ ...base, type: "dom_mutation", meta, mutations: [mutation] });
    expect(store.getOriginState(1, "https://example.com")?.mutations.size).toBe(1);
  });
});

// ── StateStore – Tab lifecycle ────────────────────────────────────────────────

describe("StateStore – tab lifecycle", () => {
  it("tab_opened creates a tab entry", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "tab_opened", tabId: 2, url: "https://example.com", title: "Example" });
    expect(store.getTab(2)?.url).toBe("https://example.com");
    expect(store.getTab(2)?.title).toBe("Example");
  });

  it("tab_closed removes tab and emits tab_removed", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "k", value: "v", oldValue: null });
    const removed: number[] = [];
    store.on("tab_removed", (id: number) => removed.push(id));
    store.applyMessage({ ...base, type: "tab_closed", tabId: 1 });
    expect(store.getTab(1)).toBeUndefined();
    expect(removed).toContain(1);
  });
});

// ── StateStore – Events ───────────────────────────────────────────────────────

describe("StateStore – events", () => {
  it("emits origin_updated with correct tabId and origin on storage write", () => {
    const store = new StateStore();
    const events: [number, string][] = [];
    store.on("origin_updated", (tabId: number, origin: string) => events.push([tabId, origin]));
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "x", value: "y", oldValue: null });
    expect(events).toEqual([[1, "https://example.com"]]);
  });

  it("clearAll emits all_cleared", () => {
    const store = new StateStore();
    let fired = false;
    store.on("all_cleared", () => { fired = true; });
    store.clearAll();
    expect(fired).toBe(true);
  });
});

// ── StateStore – getAllTabs ────────────────────────────────────────────────────

describe("StateStore – getAllTabs", () => {
  it("returns all currently tracked tabs", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta: { ...meta, tabId: 1 }, key: "k", value: "v", oldValue: null });
    store.applyMessage({ ...base, type: "localstorage_set", meta: { ...meta, tabId: 2 }, key: "k", value: "v", oldValue: null });
    expect(store.getAllTabs().length).toBe(2);
  });
});

// ── StateStore – collectStale ─────────────────────────────────────────────────

describe("StateStore – collectStale", () => {
  it("removes stale tabs and keeps recent ones", () => {
    const store = new StateStore();
    store.applyMessage({ ...base, type: "localstorage_set", meta: { ...meta, tabId: 10 }, key: "k", value: "v", oldValue: null });
    // Force lastActivity to be in the past
    const staleTab = store.getTab(10)!;
    (staleTab as unknown as Record<string, unknown>)["lastActivity"] = new Date(Date.now() - 10_000).toISOString();

    store.applyMessage({ ...base, type: "localstorage_set", meta: { ...meta, tabId: 11 }, key: "k", value: "v", oldValue: null });

    const removed = store.collectStale(5_000);
    expect(removed).toContain(10);
    expect(removed).not.toContain(11);
    expect(store.getTab(10)).toBeUndefined();
    expect(store.getTab(11)).toBeDefined();
  });
});

// ── StateStore – clearOrigin ──────────────────────────────────────────────────

describe("StateStore – clearOrigin", () => {
  it("removes only the specified origin and emits origin_updated", () => {
    const store = new StateStore();
    const origin2 = "https://other.com";
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "a", value: "1", oldValue: null });
    store.applyMessage({ ...base, type: "localstorage_set", meta: { ...meta, origin: origin2, url: "https://other.com/" }, key: "b", value: "2", oldValue: null });

    const events: string[] = [];
    store.on("origin_updated", (_tabId: number, origin: string) => events.push(origin));

    store.clearOrigin(1, "https://example.com");

    expect(store.getTab(1)?.byOrigin.has("https://example.com")).toBe(false);
    expect(store.getTab(1)?.byOrigin.has(origin2)).toBe(true);
    expect(events).toContain("https://example.com");
  });
});
