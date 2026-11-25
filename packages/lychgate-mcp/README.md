# lychgate-mcp

An MCP server (stdio) that gives coding agents Lychgate's link scanner: find dead links, see how they died, and get the Wayback snapshot closest before the link was cited. It never writes files; patches come back as text.

Tools: `scan_links`, `classify_url`, `find_snapshot`, `check_drift` and `suggest_replacement`. The server identifies itself as `lychgate`. The remaining work is listed in `.kiro/specs/mcp-server/tasks.md`.

## Build

From the Lychgate repo root:

```bash
pnpm mcp:build   # writes packages/lychgate-mcp/dist/index.js (single file, runs with node)
```

## Register in Kiro

Add this to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "lychgate": {
      "command": "node",
      "args": ["packages/lychgate-mcp/dist/index.js"]
    }
  }
}
```

Once published, `"command": "npx", "args": ["-y", "lychgate-mcp"]` works without a checkout.

## Licence

MIT © Demir ([demir-sama](https://github.com/demir-sama))
