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
  ${cyan("resources")}                              List all available MCP resources
  ${cyan("tabs")}                                   Read browser://tabs (all open tabs + origins)
  ${cyan("ls")} ${yellow("<tabId> <origin>")}               Read localStorage for a tab+origin
  ${cyan("search")} ${yellow("<tabId> <origin> <pattern>")} Search localStorage+sessionStorage by value
  ${cyan("diff")} ${yellow("<tabId> <origin>")}             Diff localStorage against a stored baseline
  ${cyan("decode")} ${yellow("<tabId> <origin> <key>")}     Decode a storage value (JWT/base64/JSON)
  ${cyan("set")} ${yellow("<tabId> <origin> <k> <v>")}      Write a localStorage key in the browser
  ${cyan("del")} ${yellow("<tabId> <origin> <key>")}        Delete a localStorage key in the browser
  ${cyan("navigate")} ${yellow("<tabId> <url>")}            Navigate a tab to a URL
  ${cyan("snapshot")} ${yellow("<tabId>")}                  Request a fresh storage snapshot
  ${cyan("mutations")} ${yellow("<tabId> [origin]")}        Recent DOM mutation events for a tab
  ${cyan("read")} ${yellow("<uri>")}                        Read any MCP resource by URI
  ${cyan("tool")} ${yellow("<name> <json-args>")}           Call any MCP tool with JSON args
  ${cyan("help")}                                   Show this help
  ${cyan("exit")}                                   Quit
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

          // ── Search storage ────────────────────────────────────────────────
          case "search": {
            if (args.length < 3) { err("Usage: search <tabId> <origin> <valuePattern>"); break; }
            const [tabId, origin, ...rest] = args;
            const data = await bridge.callTool("search_storage", { tabId: parseInt(tabId!, 10), origin, valuePattern: rest.join(" ") });
            console.log(`\n${bold("Search results")}`); printJson(data); break;
          }

          // ── Diff storage ──────────────────────────────────────────────────
          case "diff": {
            if (args.length < 2) { err("Usage: diff <tabId> <origin>"); break; }
            const [tabId, origin] = args;
            // Capture baseline first
            const baseline = await bridge.callTool("read_storage", { tabId: parseInt(tabId!, 10), origin, storageType: "localStorage" }) as { entries?: Record<string, string> };
            info("Baseline captured. Press Enter after your action to see the diff…");
            await new Promise<void>((resolve) => rl.once("line", () => resolve()));
            const data = await bridge.callTool("diff_storage", { tabId: parseInt(tabId!, 10), origin, storageType: "localStorage", baseline: baseline?.entries ?? {} });
            console.log(`\n${bold("Diff")}`); printJson(data); break;
          }

          // ── Decode storage value ──────────────────────────────────────────
          case "decode": {
            if (args.length < 3) { err("Usage: decode <tabId> <origin> <key>"); break; }
            const [tabId, origin, key] = args;
            const data = await bridge.callTool("decode_storage_value", { tabId: parseInt(tabId!, 10), origin, storageType: "localStorage", key });
            console.log(`\n${bold("Decoded")}`); printJson(data); break;
          }

          // ── Set storage ───────────────────────────────────────────────────
          case "set": {
            if (args.length < 4) { err("Usage: set <tabId> <origin> <key> <value>"); break; }
            const [tabId, origin, key, ...valParts] = args;
            const data = await bridge.callTool("set_storage", { tabId: parseInt(tabId!, 10), origin, storageType: "localStorage", key, value: valParts.join(" ") });
            printJson(data); break;
          }

          // ── Delete storage ────────────────────────────────────────────────
          case "del":
          case "delete": {
            if (args.length < 3) { err("Usage: del <tabId> <origin> <key>"); break; }
            const [tabId, origin, key] = args;
            const data = await bridge.callTool("delete_storage", { tabId: parseInt(tabId!, 10), origin, storageType: "localStorage", key });
            printJson(data); break;
          }

          // ── Navigate tab ──────────────────────────────────────────────────
          case "navigate": {
            if (args.length < 2) { err("Usage: navigate <tabId> <url>"); break; }
            const [tabId, url] = args;
            const data = await bridge.callTool("navigate_tab", { tabId: parseInt(tabId!, 10), url });
            printJson(data); break;
          }

          // ── Request snapshot ──────────────────────────────────────────────
          case "snapshot": {
            if (!args[0]) { err("Usage: snapshot <tabId>"); break; }
            const data = await bridge.callTool("request_snapshot", { tabId: parseInt(args[0], 10), target: "all" });
            printJson(data); break;
          }

          // ── Generic tool call ─────────────────────────────────────────────
          case "tool": {
            if (args.length < 2) { err('Usage: tool <name> <json-args>  e.g. tool search_storage \'{"tabId":1,"origin":"https://example.com","valuePattern":"eyJ"}\''); break; }
            const [toolName, ...jsonParts] = args;
            let toolArgs: Record<string, unknown> = {};
            try { toolArgs = JSON.parse(jsonParts.join(" ")) as Record<string, unknown>; } catch { err("Invalid JSON args"); break; }
            const data = await bridge.callTool(toolName!, toolArgs);
            console.log(`\n${bold(toolName!)}`); printJson(data); break;
          }

          // ── DOM mutations ─────────────────────────────────────────────────
          case "mutations": {
            if (!args[0]) { err("Usage: mutations <tabId> [origin]"); break; }
            const tabId = parseInt(args[0], 10);
            const origin = args[1];
            const toolArgs: Record<string, unknown> = { tabId };
            if (origin) toolArgs["origin"] = origin;
            const data = await bridge.callTool("get_dom_mutations", toolArgs);
            const label = origin ? `Mutations · tab ${tabId} · ${origin}` : `Mutations · tab ${tabId}`;
            console.log(`\n${bold(label)}`);
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
