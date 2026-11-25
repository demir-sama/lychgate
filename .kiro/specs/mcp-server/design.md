# mcp-server: design

```
Kiro (IDE / CLI) ──stdio──▶ packages/lychgate-mcp/src/index.ts
                                │  McpServer + StdioServerTransport (@modelcontextprotocol/sdk)
                                │  zod schemas per tool
                                ▼
                         ../../lib/scan/engine.ts   runScan()  (same engine as /api/scan)
                         ../../lib/archive/wayback.ts  pickSnapshot / cdx
                         ../../lib/patch/patch.ts      patchMarkdown / unifiedDiff
```

## Decisions
- **No fork of the logic.** The package imports `lib/` by relative path and is bundled with esbuild (`--bundle --platform=node --format=esm`) into one file, so the web app and the agent always agree on what "dead" means.
- **Path tool is sandboxed.** `scan_links { path }` resolves with `fs.realpath` and must stay under `process.cwd()` (R3.2). It reads the file and runs it as `{ kind: "markdown", text }`, keeping per-line occurrences so results point at `file:line`.
- **Read-only.** Patches come back as text (R3.3). The hook prompt tells the agent to offer, never apply.
- **Output shape.** `content: [{ type: "text", text: summary }, { type: "text", text: JSON.stringify(details) }]` (R2.6). Living links are left out of `scan_links` to save the agent's context; counts still include them.
- **Caps.** `runScan(input, { budgetMs: 120_000, signal })` with an AbortController; `MAX_LINKS` already caps at 300.

## Testing
- Unit: zod schemas reject bad input; the path guard refuses `../` and absolute paths outside cwd (property test with fast-check over generated path segments).
- Smoke: `tests/mcp.test.ts` spawns `node packages/lychgate-mcp/dist/index.js`, connects a `Client` over stdio, checks `listTools` returns the four tools, and calls `classify_url { url: "http://169.254.169.254/" }` expecting Sealed.
