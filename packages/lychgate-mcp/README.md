# lychgate-mcp

An MCP server (stdio) that gives coding agents Lychgate's link scanner: find dead links, see how they died, and get the Wayback snapshot closest before the link was cited. It is read-only: it never writes files and never opens pull requests; patches come back as text. To write fixes, use Fix it on the Lychgate site (a pull request you open with your own token) or the Lychgate GitHub Action (a check in CI).

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
