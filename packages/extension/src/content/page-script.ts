// Runs in the MAIN world — has direct access to the page's JavaScript environment.
// Intercepts Storage.prototype before any page scripts execute so no mutations are missed.
// Communicates back to the ISOLATED world (content-main.ts) via window.postMessage.
(function () {
  const PREFIX = "__voidwalker";

  function post(data: Record<string, unknown>): void {
    window.postMessage({ [PREFIX]: true, ...data }, window.location.origin);
  }

  // Capture original methods before any other script can overwrite them
  const _setItem = Storage.prototype.setItem;
  const _removeItem = Storage.prototype.removeItem;
  const _clear = Storage.prototype.clear;

  Storage.prototype.setItem = function (key: string, value: string): void {
    const oldValue = this.getItem(key);
    _setItem.call(this, key, value);
    const isLocal = this === window.localStorage;
    post({
      type: isLocal ? "localstorage_set" : "sessionstorage_set",
      meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
      key,
      value,
      oldValue,
    });
  };

  Storage.prototype.removeItem = function (key: string): void {
    const oldValue = this.getItem(key);
    _removeItem.call(this, key);
    const isLocal = this === window.localStorage;
    post({
      type: isLocal ? "localstorage_remove" : "sessionstorage_remove",
      meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
      key,
      oldValue,
    });
  };

  Storage.prototype.clear = function (): void {
    const isLocal = this === window.localStorage;
    // Snapshot state before clearing so the server can reconstruct the diff
    const previousState: Record<string, string> = {};
    for (let i = 0; i < this.length; i++) {
      const k = this.key(i)!;
      previousState[k] = this.getItem(k)!;
    }
    _clear.call(this);
    post({
      type: isLocal ? "localstorage_clear" : "sessionstorage_clear",
      meta: { origin: location.origin, url: location.href, pageClock: Date.now() },
      previousState,
    });
  };

  // ─── IndexedDB interception ───────────────────────────────────────────────
  // Wrap IDBFactory.prototype.open so every database opened by the page is
  // observed. Mutation operations (put/add/delete/clear) are intercepted on
  // IDBObjectStore to stream individual record changes to the MCP server.

  const meta = () => ({ origin: location.origin, url: location.href, pageClock: Date.now() });

  function wrapObjectStore(store: IDBObjectStore, dbName: string): IDBObjectStore {
    const _put = store.put.bind(store);
    const _add = store.add.bind(store);
    const _delete = store.delete.bind(store);
    const _clear = store.clear.bind(store);

    store.put = function (value: unknown, key?: IDBValidKey): IDBRequest {
      const req = _put(value, key as IDBValidKey);
      req.addEventListener("success", () => {
        post({
          type: "indexeddb_put",
          meta: meta(),
          dbName,
          storeName: store.name,
          key: JSON.stringify(req.result),
          value: JSON.stringify(value),
        });
      });
      return req;
    };

    store.add = function (value: unknown, key?: IDBValidKey): IDBRequest {
      const req = _add(value, key as IDBValidKey);
      req.addEventListener("success", () => {
        post({
          type: "indexeddb_put",
          meta: meta(),
          dbName,
          storeName: store.name,
          key: JSON.stringify(req.result),
          value: JSON.stringify(value),
        });
      });
      return req;
    };

    store.delete = function (query: IDBValidKey | IDBKeyRange): IDBRequest {
      const req = _delete(query);
      req.addEventListener("success", () => {
        post({
          type: "indexeddb_delete",
          meta: meta(),
          dbName,
          storeName: store.name,
          key: JSON.stringify(query),
        });
      });
      return req;
    };

    store.clear = function (): IDBRequest {
      const req = _clear();
      req.addEventListener("success", () => {
        post({
          type: "indexeddb_clear",
          meta: meta(),
          dbName,
          storeName: store.name,
        });
      });
      return req;
    };

    return store;
  }

  function wrapTransaction(tx: IDBTransaction, dbName: string): IDBTransaction {
    const _objectStore = tx.objectStore.bind(tx);
    tx.objectStore = function (name: string): IDBObjectStore {
      return wrapObjectStore(_objectStore(name), dbName);
    };
    return tx;
  }

  function wrapDatabase(db: IDBDatabase): IDBDatabase {
    const _transaction = db.transaction.bind(db);
    db.transaction = function (
      storeNames: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ): IDBTransaction {
      return wrapTransaction(_transaction(storeNames, mode, options), db.name);
    };

    // Intercept schema upgrades to capture new object stores
    db.addEventListener("versionchange", () => {
      // Nothing actionable — object store creation is captured in onupgradeneeded below
    });

    return db;
  }

  const _idbOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (
    name: string,
    version?: number,
  ): IDBOpenDBRequest {
    const req: IDBOpenDBRequest = _idbOpen.call(this, name, version);

    req.addEventListener("upgradeneeded", () => {
      const db = req.result;
      // Wrap createObjectStore to capture new stores being created
      const _create = db.createObjectStore.bind(db);
      db.createObjectStore = function (
        storeName: string,
        opts?: IDBObjectStoreParameters,
      ): IDBObjectStore {
        const store = _create(storeName, opts);
        post({
          type: "indexeddb_store_created",
          meta: meta(),
          dbName: name,
          storeName,
          keyPath: opts?.keyPath ?? null,
          autoIncrement: opts?.autoIncrement ?? false,
        });
        return wrapObjectStore(store, name);
      };
    });

    req.addEventListener("success", () => {
      wrapDatabase(req.result);
    });

    return req;
  };
})();
