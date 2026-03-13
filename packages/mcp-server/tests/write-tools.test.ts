import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/websocket.js", () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../src/websocket.js";
import {
  handleSetStorage,
  handleDeleteStorage,
  handleDeleteIndexedDB,
  handleRequestSnapshot,
  handleClearServerState,
  handleNavigateTab,
} from "../src/tools/write-tools.js";
import { StateStore } from "../src/state-store.js";

const mockSend = sendCommand as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSend.mockReset();
});

// ── handleClearServerState (no sendCommand dependency) ────────────────────────

describe("handleClearServerState", () => {
  it("scope=all clears all state and returns ok", () => {
    const store = new StateStore();
    const base = { seq: 0, ts: Date.now() };
    const meta = { tabId: 1, origin: "https://example.com", url: "https://example.com/", pageClock: Date.now() };
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "k", value: "v", oldValue: null });

    const result = JSON.parse(handleClearServerState(store, { scope: "all" }));
    expect(result.ok).toBe(true);
    expect(result.cleared).toBe("all");
    expect(store.getAllTabs().length).toBe(0);
  });

  it("scope=tab clears the specified tab", () => {
    const store = new StateStore();
    const base = { seq: 0, ts: Date.now() };
    const meta = { tabId: 5, origin: "https://example.com", url: "https://example.com/", pageClock: Date.now() };
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "k", value: "v", oldValue: null });

    const result = JSON.parse(handleClearServerState(store, { scope: "tab", tabId: 5 }));
    expect(result.ok).toBe(true);
    expect(store.getTab(5)).toBeUndefined();
  });

  it("scope=tab without tabId returns error", () => {
    const store = new StateStore();
    const result = JSON.parse(handleClearServerState(store, { scope: "tab" }));
    expect(result.error).toBeDefined();
  });

  it("scope=origin clears the specified origin", () => {
    const store = new StateStore();
    const base = { seq: 0, ts: Date.now() };
    const meta = { tabId: 1, origin: "https://example.com", url: "https://example.com/", pageClock: Date.now() };
    store.applyMessage({ ...base, type: "localstorage_set", meta, key: "k", value: "v", oldValue: null });

    const result = JSON.parse(handleClearServerState(store, { scope: "origin", tabId: 1, origin: "https://example.com" }));
    expect(result.ok).toBe(true);
    expect(store.getTab(1)?.byOrigin.has("https://example.com")).toBe(false);
  });

  it("scope=origin without origin returns error", () => {
    const store = new StateStore();
    const result = JSON.parse(handleClearServerState(store, { scope: "origin", tabId: 1 }));
    expect(result.error).toBeDefined();
  });
});

// ── sendCommand-dependent handlers ────────────────────────────────────────────

describe("handleSetStorage", () => {
  it("returns error when no extension connected", () => {
    mockSend.mockReturnValue(false);
    const store = new StateStore();
    const result = JSON.parse(handleSetStorage(store, {
      tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "k", value: "v",
    }));
    expect(result.error).toBeDefined();
  });

  it("returns ok with echoed args when extension is connected", () => {
    mockSend.mockReturnValue(true);
    const store = new StateStore();
    const result = JSON.parse(handleSetStorage(store, {
      tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "k", value: "v",
    }));
    expect(result.ok).toBe(true);
    expect(result.key).toBe("k");
    expect(result.value).toBe("v");
  });
});

describe("handleDeleteStorage", () => {
  it("returns error when no extension connected", () => {
    mockSend.mockReturnValue(false);
    const result = JSON.parse(handleDeleteStorage(new StateStore(), {
      tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "k",
    }));
    expect(result.error).toBeDefined();
  });

  it("returns ok when extension is connected", () => {
    mockSend.mockReturnValue(true);
    const result = JSON.parse(handleDeleteStorage(new StateStore(), {
      tabId: 1, origin: "https://example.com", storageType: "localStorage", key: "k",
    }));
    expect(result.ok).toBe(true);
  });
});

describe("handleDeleteIndexedDB", () => {
  it("returns error when no extension connected", () => {
    mockSend.mockReturnValue(false);
    const result = JSON.parse(handleDeleteIndexedDB(new StateStore(), {
      tabId: 1, origin: "https://example.com", dbName: "db", storeName: "store", key: '"k"',
    }));
    expect(result.error).toBeDefined();
  });

  it("returns ok when extension is connected", () => {
    mockSend.mockReturnValue(true);
    const result = JSON.parse(handleDeleteIndexedDB(new StateStore(), {
      tabId: 1, origin: "https://example.com", dbName: "db", storeName: "store", key: '"k"',
    }));
    expect(result.ok).toBe(true);
  });
});

describe("handleRequestSnapshot", () => {
  it("defaults target to 'all'", () => {
    mockSend.mockReturnValue(true);
    const result = JSON.parse(handleRequestSnapshot(new StateStore(), { tabId: 1 }));
    expect(result.target).toBe("all");
  });

  it("returns error when no extension connected", () => {
    mockSend.mockReturnValue(false);
    const result = JSON.parse(handleRequestSnapshot(new StateStore(), { tabId: 1 }));
    expect(result.error).toBeDefined();
  });
});

describe("handleNavigateTab", () => {
  it("returns error when no extension connected", () => {
    mockSend.mockReturnValue(false);
    const result = JSON.parse(handleNavigateTab(new StateStore(), { tabId: 1, url: "https://example.com" }));
    expect(result.error).toBeDefined();
  });

  it("returns ok with tabId and url when connected", () => {
    mockSend.mockReturnValue(true);
    const result = JSON.parse(handleNavigateTab(new StateStore(), { tabId: 1, url: "https://example.com" }));
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://example.com");
  });
});
