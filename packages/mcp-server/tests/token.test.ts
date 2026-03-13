import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadOrCreateToken } from "../src/utils/token.js";

function tmpTokenPath(): string {
  return join(tmpdir(), `voidwalker-test-${randomBytes(8).toString("hex")}`, "token");
}

const created: string[] = [];

afterEach(() => {
  for (const p of created.splice(0)) {
    try { rmSync(join(p, ".."), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("loadOrCreateToken", () => {
  it("creates a new 64-char hex token when file does not exist", () => {
    const path = tmpTokenPath();
    created.push(path);

    const token = loadOrCreateToken(path);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path)).toBe(true);
  });

  it("writes the token file with mode 0o600", () => {
    const path = tmpTokenPath();
    created.push(path);

    loadOrCreateToken(path);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns the same token on repeated calls", () => {
    const path = tmpTokenPath();
    created.push(path);

    const first = loadOrCreateToken(path);
    const second = loadOrCreateToken(path);
    expect(first).toBe(second);
  });

  it("reads an existing token without overwriting it", () => {
    const path = tmpTokenPath();
    created.push(path);

    const existingToken = randomBytes(32).toString("hex");
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(path, existingToken, { mode: 0o600 });

    const result = loadOrCreateToken(path);
    expect(result).toBe(existingToken);
    expect(readFileSync(path, "utf8")).toBe(existingToken);
  });
});
