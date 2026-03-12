import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Plugin } from "vite";
import { firefoxManifest } from "./manifest.firefox.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * After the bundle is written:
 *  1. Emit manifest.json
 *  2. Write background/event-page.html — loads event-page.js as an ES module.
 *     Using a background page is the MV2 workaround for ES module support in Firefox 89+.
 *  3. Copy popup.html, rewriting the Vite-specific <script type="module" src="*.ts">
 *     to reference the compiled <script type="module" src="./popup.js">.
 */
const firefoxAssetsPlugin = (): Plugin => ({
  name: "voidwalker-firefox-assets",
  closeBundle() {
    // Ensure top-level output dir exists
    mkdirSync(resolve(__dirname, "dist-firefox"), { recursive: true });

    // manifest.json
    writeFileSync(
      resolve(__dirname, "dist-firefox/manifest.json"),
      JSON.stringify(firefoxManifest, null, 2),
    );

    // background/event-page.html — thin wrapper that loads the ES module
    mkdirSync(resolve(__dirname, "dist-firefox/background"), { recursive: true });
    writeFileSync(
      resolve(__dirname, "dist-firefox/background/event-page.html"),
      `<!DOCTYPE html>\n<script type="module" src="./event-page.js"></script>\n`,
    );

    // popup/popup.html — update script reference from .ts to .js
    const popupSrc = readFileSync(resolve(__dirname, "src/popup/popup.html"), "utf-8");
    const popupAdapted = popupSrc.replace(
      /<script[^>]*src="\.\/popup\.ts"[^>]*><\/script>/,
      '<script type="module" src="./popup.js"></script>',
    );
    mkdirSync(resolve(__dirname, "dist-firefox/popup"), { recursive: true });
    writeFileSync(resolve(__dirname, "dist-firefox/popup/popup.html"), popupAdapted);
  },
});

export default defineConfig({
  build: {
    outDir: "dist-firefox",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/event-page": resolve(__dirname, "src/background/event-page.ts"),
        "content/content-main": resolve(__dirname, "src/content/content-main.ts"),
        "content/page-script": resolve(__dirname, "src/content/page-script.ts"),
        "popup/popup": resolve(__dirname, "src/popup/popup.ts"),
      },
      output: {
        // ES modules — supported in Firefox 89+ content scripts and popup pages.
        // The background script is loaded via event-page.html which uses type="module".
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
  plugins: [firefoxAssetsPlugin()],
});
