import type { McpBridge } from "./mcp-bridge.js";

interface TabsResource {
  tabs: Array<{ tabId: number; url: string; origins: string[] }>;
  totalTabs: number;
}

/** Print the current browser://tabs state to give the user immediate context. */
export async function seedContext(
  bridge: McpBridge,
  printFn: (s: string) => void,
): Promise<void> {
  try {
    const tabs = (await bridge.readResource("browser://tabs")) as TabsResource;
    if (!tabs || tabs.totalTabs === 0) {
      printFn("No browser tabs connected yet — open a tab and make sure the extension is connected.");
      return;
    }
    printFn(`\x1b[2m${tabs.totalTabs} tab(s) connected:\x1b[0m`);
    for (const t of tabs.tabs) {
      printFn(`  \x1b[36m${t.url}\x1b[0m \x1b[2m(tab ${t.tabId}, ${t.origins.length} origin(s))\x1b[0m`);
    }
    printFn("");
  } catch {
    // Server may have no state yet — not fatal
  }
}
