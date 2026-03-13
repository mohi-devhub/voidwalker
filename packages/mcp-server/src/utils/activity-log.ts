// Append-only activity log at ~/.voidwalker/activity.log.
// Logs every agent tool call so users can see exactly what the AI read or wrote.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { homedir } from "node:os";

export const ACTIVITY_LOG_PATH = join(homedir(), ".voidwalker", "activity.log");

export type ActivityAction = "read" | "write" | "admin";

export function logActivity(
  action: ActivityAction,
  tool: string,
  details: Record<string, unknown>,
): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${action.padEnd(5)} ${tool.padEnd(22)} ${JSON.stringify(details)}\n`;
  try {
    mkdirSync(dirname(ACTIVITY_LOG_PATH), { recursive: true });
    appendFileSync(ACTIVITY_LOG_PATH, line);
  } catch {
    // Never let logging errors surface to the caller
  }
}
