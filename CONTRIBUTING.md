# Contributing to Voidwalker

Thanks for your interest in contributing. This document covers how to get set up, what areas need help, and how to submit changes.

## Project structure

```
voidwalker/
├── packages/
│   ├── extension/       # Browser extension (Chrome MV3 + Firefox MV2)
│   ├── mcp-server/      # MCP server (stdio + SSE transports)
│   ├── shared/          # Shared protocol types
│   └── gemini-client/   # Gemini CLI integration
```

## Getting started

```bash
git clone https://github.com/mohi-devhub/voidwalker
cd voidwalker
npm install
npm run build
```

Run the MCP server in watch mode:

```bash
npm run dev:server
```

Run the Chrome extension with HMR:

```bash
npm run dev:extension
```

Run tests:

```bash
npm test
```

## Before submitting a PR

- Run `npm test` and make sure all tests pass
- If you add a new MCP tool, add tests for it in `packages/mcp-server/tests/`
- Keep commits small and focused — one logical change per commit
- Use conventional commit prefixes: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`

## Areas that need help

- **Tests** — the extension code has no tests; any coverage is welcome
- **Coming soon features** — see the [README](README.md#coming-soon) for planned work
- **Firefox** — Firefox support exists but gets less testing than Chrome
- **Docs** — usage examples, tutorials, and guides

## Security issues

Please do not open a public issue for security vulnerabilities. Report them privately via [GitHub's private vulnerability reporting](https://github.com/mohi-devhub/voidwalker/security/advisories/new).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
