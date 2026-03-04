import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { TOKEN_PATH } from "@voidwalker/shared";

export function loadOrCreateToken(path = TOKEN_PATH): string {
  if (existsSync(path)) {
    return readFileSync(path, "utf8").trim();
  }
  const token = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, token, { mode: 0o600 });
  process.stderr.write(`[voidwalker] New auth token written to ${path}\n`);
  return token;
}
