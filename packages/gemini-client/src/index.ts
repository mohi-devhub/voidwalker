#!/usr/bin/env node
import readline from "node:readline";
import { McpBridge } from "./mcp-bridge.js";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const B = "\x1b[1m";       // bold
const D = "\x1b[2m";       // dim
const CY = "\x1b[36m";     // cyan
const GR = "\x1b[32m";     // green
const YL = "\x1b[33m";     // yellow
const RD = "\x1b[31m";     // red
const RS = "\x1b[0m";      // reset

const bold = (s: string) => `${B}${s}${RS}`;
const cyan = (s: string) => `${CY}${s}${RS}`;
const green = (s: string) => `${GR}${s}${RS}`;
const dim = (s: string) => `${D}${s}${RS}`;
const red = (s: string) => `${RD}${s}${RS}`;
const yellow = (s: string) => `${YL}${s}${RS}`;

function ok(msg: string) { console.log(green("✓") + " " + msg); }
function err(msg: string) { console.error(red("✗") + " " + msg); }
function info(msg: string) { console.log(dim(msg)); }

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

// ─── Help text ────────────────────────────────────────────────────────────────
const HELP = `
${bold("Commands:")}
  ${cyan("resources")}                 List all available MCP resources
  ${cyan("tabs")}                      Read browser://tabs  (all open tabs + origins)
  ${cyan("ls")} ${yellow("<tabId> <origin>")}    Read localStorage for a specific tab+origin
                             e.g. ${dim("ls 1 https://localhost:3000")}
  ${cyan("read")} ${yellow("<uri>")}              Read any MCP resource by URI
                             e.g. ${dim("read browser://tabs/1/origins/https%3A%2F%2Flocalhost%3A3000/localstorage")}
  ${cyan("help")}                      Show this help
  ${cyan("exit")}                      Quit
`;

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const bridge = new McpBridge();

  process.stdout.write("Connecting to Voidwalker MCP server … ");
  try {
    await bridge.connect();
    process.stdout.write(green("connected") + "\n");
  } catch (e) {
    process.stdout.write(red("failed") + "\n");
    err(`Cannot reach MCP server. Start it with: npm run dev:server\n  ${String(e)}`);
    process.exit(1);
  }

  console.log(`\n${bold("Voidwalker")} — browser storage inspector`);
  info('Type "help" for available commands.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question(`${bold(">")} `, async (raw) => {
      const line = raw.trim();
      if (!line) { ask(); return; }

      const parts = line.split(/\s+/);
      const cmd = parts[0]!.toLowerCase();
      const args = parts.slice(1);

      try {
        switch (cmd) {

          // ── List all resources ───────────────────────────────────────────
          case "resources":
          case "list": {
            const list = await bridge.listResources();
            if (list.length === 0) {
              info("No resources yet. Is the extension connected and a tab open?");
            } else {
              console.log(`\n${bold(`Resources (${list.length})`)}`);
              for (const r of list) {
                console.log(`  ${cyan(r.uri)}`);
                if (r.name) info(`    ${r.name}`);
              }
            }
            break;
          }

          // ── All tabs ─────────────────────────────────────────────────────
          case "tabs": {
            const data = await bridge.readResource("browser://tabs");
            console.log(`\n${bold("Browser Tabs")}`);
            printJson(data);
            break;
          }

          // ── localStorage shorthand ────────────────────────────────────────
          case "ls": {
            if (args.length < 2) {
              err(`Usage: ls <tabId> <origin>   e.g. ls 1 https://localhost:3000`);
              break;
            }
            const [tabId, origin] = args;
            const uri = `browser://tabs/${tabId}/origins/${encodeURIComponent(origin!)}/localstorage`;
            const data = await bridge.readResource(uri);
            console.log(`\n${bold(`localStorage`)} ${dim(`tab ${tabId} · ${origin}`)}`);
            printJson(data);
            break;
          }

          // ── Read any resource by URI ──────────────────────────────────────
          case "read": {
            if (!args[0]) { err("Usage: read <uri>"); break; }
            const data = await bridge.readResource(args[0]);
            console.log(`\n${bold(args[0])}`);
            printJson(data);
            break;
          }

          // ── Help ─────────────────────────────────────────────────────────
          case "help":
          case "h":
          case "?":
            console.log(HELP);
            break;

          // ── Exit ─────────────────────────────────────────────────────────
          case "exit":
          case "quit":
          case "q":
            await bridge.close();
            rl.close();
            return;

          default:
            err(`Unknown command: ${cmd}. Type "help" for usage.`);
        }
      } catch (e) {
        err(String(e));
      }

      ask();
    });
  };

  ask();

  rl.on("close", async () => {
    await bridge.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`Fatal: ${e}`);
  process.exit(1);
});
