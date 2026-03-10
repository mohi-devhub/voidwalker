// Pure read-only analysis tools: search, diff, decode.
// These operate entirely on in-memory state and require no extension round-trip.
import type { StateStore } from "../state-store.js";

// ── Tool definitions ──────────────────────────────────────────────────────────

export const searchStorageTool = {
  name: "search_storage",
  description:
    "Search localStorage or sessionStorage entries by key or value pattern. Useful for finding JWTs, tokens, or any substring across all keys.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      storageType: {
        type: "string",
        enum: ["localStorage", "sessionStorage", "both"],
        description: "Which storage to search (default: both)",
      },
      keyPattern: { type: "string", description: "Substring to match against key (case-insensitive)" },
      valuePattern: { type: "string", description: "Substring to match against value (case-insensitive)" },
    },
    required: ["tabId", "origin"],
  },
};

export const searchIndexedDBTool = {
  name: "search_indexeddb",
  description:
    "Search IndexedDB records by serialized value pattern across all stores in a database.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      dbName: { type: "string", description: "IndexedDB database name" },
      storeName: { type: "string", description: "Object store name (omit to search all stores)" },
      valuePattern: { type: "string", description: "Substring to match in the serialized record value (case-insensitive)" },
      limit: { type: "number", description: "Max results to return (default 50)" },
    },
    required: ["tabId", "origin", "dbName", "valuePattern"],
  },
};

export const decodeStorageValueTool = {
  name: "decode_storage_value",
  description:
    "Decode a storage value. Attempts JSON parse, base64 decode, and JWT segment decode. Returns all successful interpretations.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      storageType: {
        type: "string",
        enum: ["localStorage", "sessionStorage"],
        description: "Which storage the key lives in",
      },
      key: { type: "string", description: "Storage key whose value to decode" },
    },
    required: ["tabId", "origin", "storageType", "key"],
  },
};

export const diffStorageTool = {
  name: "diff_storage",
  description:
    "Compare current localStorage or sessionStorage against a provided baseline snapshot. Returns added, removed, and changed keys.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Browser tab ID" },
      origin: { type: "string", description: "Origin, e.g. https://example.com" },
      storageType: {
        type: "string",
        enum: ["localStorage", "sessionStorage"],
        description: "Which storage to diff",
      },
      baseline: {
        type: "object",
        description: "Previous snapshot as a key-value object (from a prior read_storage call)",
        additionalProperties: { type: "string" },
      },
    },
    required: ["tabId", "origin", "storageType", "baseline"],
  },
};

// ── Handlers ──────────────────────────────────────────────────────────────────

export function handleSearchStorage(stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, storageType = "both", keyPattern, valuePattern } = args as {
    tabId: number;
    origin: string;
    storageType?: "localStorage" | "sessionStorage" | "both";
    keyPattern?: string;
    valuePattern?: string;
  };

  const os = stateStore.getOriginState(tabId, origin);
  if (!os) return JSON.stringify({ error: `No state for tab ${tabId} origin ${origin}` });

  const keyLc = keyPattern?.toLowerCase();
  const valLc = valuePattern?.toLowerCase();

  const results: Array<{ storageType: string; key: string; value: string }> = [];

  const search = (type: "localStorage" | "sessionStorage") => {
    const source = type === "localStorage" ? os.localStorage : os.sessionStorage;
    for (const [k, v] of source.entries) {
      if (keyLc && !k.toLowerCase().includes(keyLc)) continue;
      if (valLc && !v.toLowerCase().includes(valLc)) continue;
      results.push({ storageType: type, key: k, value: v });
    }
  };

  if (storageType === "both" || storageType === "localStorage") search("localStorage");
  if (storageType === "both" || storageType === "sessionStorage") search("sessionStorage");

  return JSON.stringify({ tabId, origin, results, resultCount: results.length }, null, 2);
}

export function handleSearchIndexedDB(stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, dbName, storeName, valuePattern, limit = 50 } = args as {
    tabId: number;
    origin: string;
    dbName: string;
    storeName?: string;
    valuePattern: string;
    limit?: number;
  };

  const os = stateStore.getOriginState(tabId, origin);
  const db = os?.indexedDB.get(dbName);
  if (!db) return JSON.stringify({ error: `Database "${dbName}" not found for origin ${origin}` });

  const valLc = valuePattern.toLowerCase();
  const results: Array<{ storeName: string; key: string; value: string }> = [];

  const storeNames = storeName ? [storeName] : Array.from(db.stores.keys());
  for (const sName of storeNames) {
    const store = db.stores.get(sName);
    if (!store) continue;
    for (const [k, v] of store.records) {
      if (!v.toLowerCase().includes(valLc)) continue;
      results.push({ storeName: sName, key: k, value: v });
      if (results.length >= (limit as number)) break;
    }
    if (results.length >= (limit as number)) break;
  }

  const truncated = results.length >= (limit as number);
  return JSON.stringify({ tabId, origin, dbName, results, resultCount: results.length, truncated }, null, 2);
}

export function handleDecodeStorageValue(stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, storageType, key } = args as {
    tabId: number;
    origin: string;
    storageType: "localStorage" | "sessionStorage";
    key: string;
  };

  const os = stateStore.getOriginState(tabId, origin);
  const source = storageType === "localStorage" ? os?.localStorage : os?.sessionStorage;
  const raw = source?.entries.get(key);

  if (raw === undefined) {
    return JSON.stringify({ error: `Key "${key}" not found in ${storageType} for origin ${origin}` });
  }

  const interpretations: Record<string, unknown> = { raw };

  // JSON parse
  try { interpretations["json"] = JSON.parse(raw); } catch { /* not JSON */ }

  // Base64 decode
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    // Only include if it looks like valid text
    if (/^[\x20-\x7E\n\r\t]*$/.test(decoded)) {
      interpretations["base64"] = decoded;
      try { interpretations["base64_json"] = JSON.parse(decoded); } catch { /* not JSON */ }
    }
  } catch { /* not base64 */ }

  // JWT decode (three dot-separated base64url segments)
  const jwtParts = raw.split(".");
  if (jwtParts.length === 3) {
    try {
      const decodeSegment = (s: string) =>
        JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      interpretations["jwt"] = {
        header: decodeSegment(jwtParts[0]!),
        payload: decodeSegment(jwtParts[1]!),
        signaturePresent: true,
      };
    } catch { /* not a valid JWT */ }
  }

  return JSON.stringify({ tabId, origin, storageType, key, interpretations }, null, 2);
}

export function handleDiffStorage(stateStore: StateStore, args: Record<string, unknown>): string {
  const { tabId, origin, storageType, baseline } = args as {
    tabId: number;
    origin: string;
    storageType: "localStorage" | "sessionStorage";
    baseline: Record<string, string>;
  };

  const os = stateStore.getOriginState(tabId, origin);
  const current: Record<string, string> = os
    ? Object.fromEntries(
        storageType === "localStorage" ? os.localStorage.entries : os.sessionStorage.entries,
      )
    : {};

  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const changed: Array<{ key: string; before: string; after: string }> = [];
  const unchanged: string[] = [];

  for (const key of Object.keys(current)) {
    if (!(key in baseline)) {
      added[key] = current[key]!;
    } else if (baseline[key] !== current[key]) {
      changed.push({ key, before: baseline[key]!, after: current[key]! });
    } else {
      unchanged.push(key);
    }
  }
  for (const key of Object.keys(baseline)) {
    if (!(key in current)) removed[key] = baseline[key]!;
  }

  return JSON.stringify(
    {
      tabId, origin, storageType,
      added, removed, changed,
      unchangedCount: unchanged.length,
      summary: {
        addedCount: Object.keys(added).length,
        removedCount: Object.keys(removed).length,
        changedCount: changed.length,
      },
    },
    null, 2,
  );
}
