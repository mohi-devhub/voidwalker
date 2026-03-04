import { EventEmitter } from "node:events";
import type { ExtensionMessage } from "@voidwalker/shared";

export interface OriginState {
  origin: string;
  localStorage: { entries: Map<string, string>; lastUpdated: string };
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
      case "tab_closed":
        this.clearTab(msg.tabId);
        break;
      default:
        break; // Additional message types handled in later phases
    }
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
      os = { origin, localStorage: { entries: new Map(), lastUpdated: new Date().toISOString() } };
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
