# Voidwalker

Give AI coding agents real-time visibility into your browser's storage state.

Voidwalker is a browser extension + local MCP server that streams localStorage, sessionStorage, IndexedDB, cookies, and DOM mutations to any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, etc.). The AI can read, search, diff, and write browser storage while you work — no DevTools required.

## How it works

```
Browser Tab → Content Script → Background Worker → WebSocket (localhost:3695) → MCP Server → AI Client
```

All data stays on your machine. The server binds exclusively to `127.0.0.1` and authenticates via a local token file.

## Prerequisites

- Node.js 18+
- Chrome (MV3) or Firefox (MV2)
- An MCP-compatible AI client

## Installation

**1. Clone and build**

```bash
git clone https://github.com/your-org/voidwalker
cd voidwalker
npm install
npm run build
```

**2. Load the browser extension**

*Chrome:*
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select `packages/extension/dist/`

*Firefox:*
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `packages/extension/dist-firefox/manifest.json`

**3. Start the MCP server (first run)**

```bash
node packages/mcp-server/dist/index.js
```

On first start, a token is generated at `~/.voidwalker/token`.

**4. Configure the extension**

Click the Voidwalker toolbar icon and paste the token from `~/.voidwalker/token`. The status dot turns green when the extension connects to the server.

## Configure your AI client

### Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "voidwalker": {
      "command": "node",
      "args": ["/absolute/path/to/voidwalker/packages/mcp-server/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add voidwalker -- node /absolute/path/to/voidwalker/packages/mcp-server/dist/index.js
```

### Cursor / other SSE clients

Start the server manually, then connect via SSE at `http://127.0.0.1:3695/sse`.

## Verify it works

1. Open any webpage in your browser
2. The extension popup status dot should be green
3. Ask your AI: *"What's in localStorage for the current tab?"*
4. The AI calls `read_storage` and returns the current state

## Available MCP tools

| Tool | Description |
|------|-------------|
| `read_storage` | Read localStorage or sessionStorage |
| `query_indexeddb` | Query an IndexedDB object store |
| `get_cookie` | Get a specific cookie |
| `search_cookies` | Search cookies by pattern |
| `search_storage` | Search storage by key/value pattern |
| `search_indexeddb` | Search IndexedDB records by value pattern |
| `decode_storage_value` | Decode a value (JSON, base64, JWT) |
| `diff_storage` | Compare current storage against a baseline |
| `get_dom_mutations` | Get recent DOM mutations |
| `set_storage` | Write a key to localStorage/sessionStorage |
| `delete_storage` | Delete a key from localStorage/sessionStorage |
| `delete_indexeddb` | Delete an IndexedDB record |
| `request_snapshot` | Refresh state from the extension |
| `clear_server_state` | Clear in-memory state on the server |
| `navigate_tab` | Navigate a tab to a URL |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VOIDWALKER_PORT` | `3695` | WebSocket + HTTP port |
| `VOIDWALKER_RETENTION_MS` | `300000` | Closed-tab state retention (ms) |
| `VOIDWALKER_TOKEN_PATH` | `~/.voidwalker/token` | Auth token file path |

## Development

```bash
npm run dev:server      # MCP server with tsx watch
npm run dev:extension   # Chrome extension with Vite HMR
npm test                # Run all tests (vitest)
```

Build Firefox extension:

```bash
npm run build:firefox --workspace=packages/extension
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full explanation of the data flow, security model, and design decisions.
