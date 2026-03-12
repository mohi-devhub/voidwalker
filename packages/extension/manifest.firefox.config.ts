// Firefox MV2 manifest — used by vite.firefox.config.ts to write manifest.json.
// Firefox 109+ is required for robust content-script module support.
export const firefoxManifest = {
  manifest_version: 2,
  name: "Voidwalker",
  version: "0.1.0",
  description: "Zero-state local MCP for browser storage",

  browser_specific_settings: {
    gecko: {
      id: "voidwalker@voidwalker.dev",
      strict_min_version: "109.0",
    },
  },

  permissions: ["storage", "tabs", "alarms", "cookies", "<all_urls>"],

  browser_action: {
    default_popup: "popup/popup.html",
    default_title: "Voidwalker",
  },

  // Use a background page so the script can be loaded as an ES module (MV2 + Firefox 89+).
  // background.scripts does not support type:module; background.page does via a <script> tag.
  background: {
    page: "background/event-page.html",
    persistent: false,
  },

  content_scripts: [
    {
      // In Firefox MV2, world: "MAIN" is not supported.
      // content-main.ts injects page-script.js into the MAIN world via a <script> tag.
      matches: ["<all_urls>"],
      js: ["content/content-main.js"],
      run_at: "document_start",
    },
  ],

  // page-script.js must be web-accessible so content-main.ts can inject it as a <script>
  web_accessible_resources: ["content/page-script.js"],
};
