import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Voidwalker",
  version: "0.1.0",
  description: "Zero-state local MCP for browser storage",

  permissions: ["storage", "tabs", "alarms", "cookies"],
  host_permissions: ["<all_urls>"],

  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },

  content_scripts: [
    {
      // Runs in the page's MAIN world — intercepts Storage prototype before page scripts.
      // Requires Chrome 111+.
      matches: ["<all_urls>"],
      js: ["src/content/page-script.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      // Runs in the ISOLATED world — relays postMessages from page-script to background.
      matches: ["<all_urls>"],
      js: ["src/content/content-main.ts"],
      run_at: "document_start",
    },
  ],
});
