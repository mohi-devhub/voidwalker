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
 *  2. Copy popup.html, rewriting the Vite-specific <script type="module" src="*.ts">
 *     to a plain <script src="*.js"> that works in a bundled MV2 context.
 */
const firefoxAssetsPlugin = (): Plugin => ({
  name: "voidwalker-firefox-assets",
  closeBundle() {
    // manifest.json
    writeFileSync(
      resolve(__dirname, "dist-firefox/manifest.json"),
      JSON.stringify(firefoxManifest, null, 2),
    );

    // popup.html — strip type="module" and replace .ts ref with compiled .js
    const src = readFileSync(resolve(__dirname, "src/popup/popup.html"), "utf-8");
    const adapted = src.replace(
      /<script[^>]*type="module"[^>]*src="\.\/popup\.ts"[^>]*><\/script>/,
      '<script src="./popup.js"></script>',
    );
    mkdirSync(resolve(__dirname, "dist-firefox/popup"), { recursive: true });
    writeFileSync(resolve(__dirname, "dist-firefox/popup/popup.html"), adapted);
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
        // IIFE bundles each script as a self-contained file — required for MV2
        // background scripts and ensures content scripts work without a module loader.
        format: "iife",
        entryFileNames: "[name].js",
        // Disable code splitting: shared deps are inlined into each bundle.
        // @voidwalker/shared only exports small constants, so duplication is negligible.
        inlineDynamicImports: false,
      },
    },
  },
  plugins: [firefoxAssetsPlugin()],
});
