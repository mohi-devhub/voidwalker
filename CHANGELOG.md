# Changelog

All notable changes to this project will be documented here.

## [1.0.0] - 2026-03-14

### Added
- Chrome MV3 extension with service worker
- Firefox MV2 extension with event page
- MCP server with stdio transport (Claude Desktop / Claude Code) and SSE transport (Cursor / Gemini CLI)
- Real-time streaming of localStorage, sessionStorage, IndexedDB, cookies, and DOM mutations
- Token-authenticated WebSocket on `ws://127.0.0.1:3695` (256-bit token, mode 0600)
- Automatic redaction of sensitive keys (`token`, `auth`, `session`, `jwt`, `password`, `secret`, etc.)
- Storage history — per-origin changelog tracking last 1,000 mutations
- Activity log at `~/.voidwalker/activity.log`
- MCP tools: `read_storage`, `query_indexeddb`, `get_cookie`, `search_cookies`, `search_storage`, `search_indexeddb`, `decode_storage_value`, `diff_storage`, `get_storage_history`, `get_dom_mutations`, `set_storage`, `delete_storage`, `delete_indexeddb`, `navigate_tab`, `request_snapshot`, `clear_server_state`
- MCP resources: `browser://tabs` and per-tab/origin resources for all storage types
- Security hardening: payload cap (5 MB), rate limiting (10 connections/IP/60s), connection eviction, postMessage origin scoping, prototype pollution fix, URL scheme enforcement
