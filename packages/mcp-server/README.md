# voidwalker-mcp

Local MCP server for [Voidwalker](https://github.com/mohi-devhub/voidwalker) — gives AI agents real-time access to your browser's localStorage, sessionStorage, IndexedDB, cookies, and DOM mutations.

## Requirements

- Node.js >= 18
- [Voidwalker browser extension](https://github.com/mohi-devhub/voidwalker) installed in Chrome or Firefox

## Installation

```bash
npm install -g voidwalker-mcp
```

## Usage

Start the server:

```bash
voidwalker-mcp
```

On first run, a 256-bit auth token is generated at `~/.voidwalker/token` (mode `0600`). Paste this token into the Voidwalker browser extension popup to connect.

## Connect to your AI client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "voidwalker": {
      "command": "voidwalker-mcp"
    }
  }
}
```

### Claude Code

```bash
claude mcp add voidwalker voidwalker-mcp
```

### Cursor / SSE clients

Start the server, then connect via SSE at `http://127.0.0.1:3695/sse?token=<your-token>`.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `VOIDWALKER_PORT` | `3695` | WebSocket + HTTP port |

## Available MCP tools

| Tool | Description |
|---|---|
| `read_storage` | Read localStorage or sessionStorage |
| `query_indexeddb` | Query an IndexedDB object store |
| `get_cookie` | Get a specific cookie |
| `search_storage` | Search storage by key or value pattern |
| `search_indexeddb` | Search IndexedDB records by value pattern |
| `search_cookies` | Search cookies by name or value pattern |
| `decode_storage_value` | Decode a value as JSON, base64, or JWT |
| `diff_storage` | Compare storage against a baseline snapshot |
| `get_storage_history` | Mutation history for an origin |
| `get_dom_mutations` | Recent DOM mutations for a tab |
| `set_storage` | Write a key to localStorage or sessionStorage |
| `delete_storage` | Delete a key from storage |
| `delete_indexeddb` | Delete a record from IndexedDB |
| `navigate_tab` | Navigate a tab to a URL |
| `request_snapshot` | Re-send a full storage snapshot |
| `clear_server_state` | Clear in-memory state |

## Security

- All traffic is local (`ws://127.0.0.1:3695`) — nothing leaves your machine
- Token-authenticated WebSocket (256-bit random token)
- Sensitive keys (`token`, `auth`, `session`, `jwt`, `password`, `secret`, etc.) are automatically redacted
- Every tool call is logged to `~/.voidwalker/activity.log`

## License

[MIT](https://github.com/mohi-devhub/voidwalker/blob/main/LICENSE)
