/** True when the extension is running inside Firefox. Safe in all extension contexts. */
export const isFirefox: boolean =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Firefox");
