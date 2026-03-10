// Listens for cookie changes via the chrome.cookies API and forwards them
// to the MCP server as CookieSetMessage / CookieRemovedMessage events.
// Cookie events are origin-scoped and not tied to a specific tab, so tabId
// is sent as null; the StateStore uses -1 as the sentinel for such entries.
import { sendMessage } from "./ws-bridge";

let seq = 0;
function nextSeq(): number {
  return seq++;
}

export function startCookieMonitor(): void {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    const c = changeInfo.cookie;
    const origin = `${c.secure ? "https" : "http"}://${c.domain.startsWith(".") ? c.domain.slice(1) : c.domain}`;
    const url = `${origin}${c.path}`;

    const serialized = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite as "no_restriction" | "lax" | "strict" | "unspecified",
      expirationDate: c.expirationDate,
      hostOnly: !c.domain.startsWith("."),
      session: c.session,
    };

    if (changeInfo.removed) {
      sendMessage({
        type: "cookie_removed",
        seq: nextSeq(),
        ts: Date.now(),
        meta: { origin, url, tabId: null },
        cookie: serialized,
        cause: changeInfo.cause as
          | "explicit"
          | "overwrite"
          | "expired"
          | "expired_overwrite"
          | "evicted",
      });
    } else {
      sendMessage({
        type: "cookie_set",
        seq: nextSeq(),
        ts: Date.now(),
        meta: { origin, url, tabId: null },
        cookie: serialized,
      });
    }
  });
}
