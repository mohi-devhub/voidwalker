import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@voidwalker/shared": resolve(__dirname, "packages/shared/src/index.ts"),
    },
  },
});
