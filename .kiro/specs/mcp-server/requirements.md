# mcp-server: requirements (EARS)

Scope: `packages/lychgate-mcp`, a Model Context Protocol server (stdio) that exposes Lychgate's scanner to coding agents, including Kiro itself. It reuses `lib/` unchanged; it never forks the classifier.

Why: links rot inside the docs an agent writes. With this server registered in `.kiro/settings/mcp.json`, Kiro can check every link it adds to a README before handing back, and the dogfood hook (`.kiro/hooks/lychgate.json`, `dogfood-doc-links`) can run on every Markdown save.

## R1 Transport and packaging
- R1.1 The server shall speak MCP over stdio using the official TypeScript SDK and identify itself as `lychgate` with the package version.
- R1.2 The server shall build to a single file `packages/lychgate-mcp/dist/index.js` runnable with `node`, so `.kiro/settings/mcp.json` can start it without a global install.
- R1.3 The package shall be publishable to npm as `lychgate-mcp` with a `bin` entry, MIT licence, and a README that shows the Kiro `mcp.json` snippet.

## R2 Tools
- R2.1 `scan_links` — WHEN given exactly one of `{ path }` (a local Markdown file inside the workspace), `{ markdown }`, `{ url }` or `{ repo }` plus an optional `citeDate`, the server shall run the same engine as `/api/scan` and return a summary (counts, health) and the non-living results worst first.
- R2.2 `classify_url` — WHEN given one `url` and an optional `citeDate`, the server shall return its class, confidence, reasons, status, final URL and snapshot.
- R2.3 `find_snapshot` — WHEN given a `url` and optional `before` date, the server shall return the Wayback snapshot picked by `pickSnapshot` (latest 200 capture at or before the date), or say plainly that none exists.
- R2.4 `check_drift` — WHEN given a `url` and a `citeDate`, the server shall return the text similarity between the snapshot at the cite date and the live page, and whether it crosses the Drifted threshold.
- R2.5 Each tool shall validate input with zod and return a readable error result (not a crash) for invalid input.
- R2.6 Each tool result shall include a short human-readable text block first (for the agent to quote) and a structured JSON block second.

## R3 Safety
- R3.1 The server shall apply the same SSRF guard as the web app on every fetch and redirect hop (`lib/fetch/guard.ts`); private, loopback, link-local and metadata targets shall come back as Sealed.
- R3.2 IF `scan_links` gets a `path` outside the server's working directory (after resolving symlinks and `..`), THEN it shall refuse.
- R3.3 The server shall never write files. Resurrection stays a suggestion: it returns the patched Markdown or a unified diff as text, and the agent or the person decides.
- R3.4 The server shall cap a scan at 300 links and 120 seconds, and report when it hit a cap.

## R4 Kiro integration
- R4.1 WHEN the package is built, `.kiro/settings/mcp.json` shall enable the `lychgate` server.
- R4.2 WHEN the server is enabled, the `dogfood-doc-links` hook shall be enabled and shall scan the saved Markdown file, report dead links with their snapshot, and offer (not apply) the patch.
- R4.3 A smoke test shall start the built server over stdio, list its tools, and call `classify_url` on a Sealed target (no network needed).
