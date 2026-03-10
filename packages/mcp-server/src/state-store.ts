import { EventEmitter } from "node:events";
import type { ExtensionMessage, SerializableCookie } from "@voidwalker/shared";

export interface IDBStoreState {
  records: Map<string, string>; // serialized key → serialized value
  lastUpdated: string;
}

export interface IDBDatabaseState {
  stores: Map<string, IDBStoreState>; // storeName → store state
  lastUpdated: string;
}

export interface OriginState {
  origin: string;
  localStorage: { entries: Map<string, string>; lastUpdated: string };
  sessionStorage: { entries: Map<string, string>; lastUpdated: string };
  indexedDB: Map<string, IDBDatabaseState>; // dbName → db state
  cookies: { entries: Map<string, SerializableCookie>; lastUpdated: string };
}

export interface TabState {
  tabId: number;
  url: string;
  title: string;
  firstSeen: string;
  lastActivity: string;
  byOrigin: Map<string, OriginState>;
}

export class StateStore extends EventEmitter {
  private tabs = new Map<number, TabState>();

  applyMessage(msg: ExtensionMessage): void {
    switch (msg.type) {
      // ── LocalStorage ──────────────────────────────────────────────────────────
      case "localstorage_set": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.localStorage.entries.set(msg.key, msg.value);
        os.localStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "localstorage_remove": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.localStorage.entries.delete(msg.key);
        os.localStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "localstorage_clear": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.localStorage.entries.clear();
        os.localStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "snapshot_localstorage": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.localStorage.entries = new Map(Object.entries(msg.entries));
        os.localStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }

      // ── SessionStorage ────────────────────────────────────────────────────────
      case "sessionstorage_set": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.sessionStorage.entries.set(msg.key, msg.value);
        os.sessionStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "sessionstorage_remove": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.sessionStorage.entries.delete(msg.key);
        os.sessionStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "sessionstorage_clear": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        os.sessionStorage.entries.clear();
        os.sessionStorage.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }

      // ── IndexedDB ─────────────────────────────────────────────────────────────
      case "indexeddb_put": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        const store = this.ensureIDBStore(os, msg.dbName, msg.storeName);
        store.records.set(msg.key, msg.value);
        store.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "indexeddb_delete": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        const store = this.ensureIDBStore(os, msg.dbName, msg.storeName);
        store.records.delete(msg.key);
        store.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "indexeddb_clear": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        const store = this.ensureIDBStore(os, msg.dbName, msg.storeName);
        store.records.clear();
        store.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "indexeddb_store_created": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        // Ensure the store entry exists; schema info is implicit in presence
        this.ensureIDBStore(os, msg.dbName, msg.storeName);
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }
      case "snapshot_indexeddb": {
        const os = this.ensureOrigin(msg.meta.tabId, msg.meta.origin, msg.meta.url);
        const now = new Date().toISOString();
        let db = os.indexedDB.get(msg.dbName);
        if (!db) {
          db = { stores: new Map(), lastUpdated: now };
          os.indexedDB.set(msg.dbName, db);
        }
        for (const { storeName, records } of msg.stores) {
          const storeState: IDBStoreState = { records: new Map(), lastUpdated: now };
          for (const { key, value } of records) {
            storeState.records.set(key, value);
          }
          db.stores.set(storeName, storeState);
        }
        db.lastUpdated = now;
        this.emit("origin_updated", msg.meta.tabId, msg.meta.origin);
        break;
      }

      // ── Cookies ───────────────────────────────────────────────────────────────
      case "cookie_set": {
        const tabId = msg.meta.tabId ?? -1;
        const os = this.ensureOrigin(tabId, msg.meta.origin, msg.meta.url);
        os.cookies.entries.set(msg.cookie.name, msg.cookie);
        os.cookies.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", tabId, msg.meta.origin);
        break;
      }
      case "cookie_removed": {
        const tabId = msg.meta.tabId ?? -1;
        const os = this.ensureOrigin(tabId, msg.meta.origin, msg.meta.url);
        os.cookies.entries.delete(msg.cookie.name);
        os.cookies.lastUpdated = new Date().toISOString();
        this.emit("origin_updated", tabId, msg.meta.origin);
        break;
      }

      // ── Tab lifecycle ─────────────────────────────────────────────────────────
      case "tab_closed":
        this.clearTab(msg.tabId);
        break;
      default:
        break;
    }
  }

  private ensureIDBStore(os: OriginState, dbName: string, storeName: string): IDBStoreState {
    let db = os.indexedDB.get(dbName);
    if (!db) {
      db = { stores: new Map(), lastUpdated: new Date().toISOString() };
      os.indexedDB.set(dbName, db);
    }
    let store = db.stores.get(storeName);
    if (!store) {
      store = { records: new Map(), lastUpdated: new Date().toISOString() };
      db.stores.set(storeName, store);
    }
    return store;
  }

  private ensureTab(tabId: number, url: string): TabState {
    let tab = this.tabs.get(tabId);
    if (!tab) {
      const now = new Date().toISOString();
      tab = { tabId, url, title: "", firstSeen: now, lastActivity: now, byOrigin: new Map() };
      this.tabs.set(tabId, tab);
    }
    tab.url = url;
    tab.lastActivity = new Date().toISOString();
    return tab;
  }

  private ensureOrigin(tabId: number, origin: string, url: string): OriginState {
    const tab = this.ensureTab(tabId, url);
    let os = tab.byOrigin.get(origin);
    if (!os) {
      const now = new Date().toISOString();
      os = {
        origin,
        localStorage: { entries: new Map(), lastUpdated: now },
        sessionStorage: { entries: new Map(), lastUpdated: now },
        indexedDB: new Map(),
        cookies: { entries: new Map(), lastUpdated: now },
      };
      tab.byOrigin.set(origin, os);
    }
    return os;
  }

  getTab(tabId: number): TabState | undefined {
    return this.tabs.get(tabId);
  }

  getAllTabs(): TabState[] {
    return Array.from(this.tabs.values());
  }

  getOriginState(tabId: number, origin: string): OriginState | undefined {
    return this.tabs.get(tabId)?.byOrigin.get(origin);
  }

  clearTab(tabId: number): void {
    this.tabs.delete(tabId);
    this.emit("tab_removed", tabId);
  }
}
