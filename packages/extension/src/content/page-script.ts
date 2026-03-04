// Runs in the MAIN world — has direct access to the page's JavaScript environment.
// Intercepts Storage.prototype before any page scripts execute so no mutations are missed.
// Communicates back to the ISOLATED world (content-main.ts) via window.postMessage.
(function () {
  const PREFIX = "__voidwalker";

  function post(data: Record<string, unknown>): void {
    window.postMessage({ [PREFIX]: true, ...data }, "*");
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
})();
