# Structure

## App (main repo)
- `app/` — App Router pages and streaming API routes
- `lib/fetch/` — HTTP client + SSRF guard
- `lib/classify/` — Living / Tombstone / Ghost / Drifted / Zombie
- `lib/archive/` — Wayback CDX + availability cache
- `lib/domain/` — RDAP helpers
- `lib/github/` — public Markdown + blame dates
- `lib/patch/` — Markdown rewrite + unified diff
- `components/graveyard/` — list + canvas views, detail drawer, resurrect flow
- `packages/lychgate-mcp/` or sibling package — MCP server
- `/.kiro/` — specs, steering, hooks, agents, settings/mcp.json (never gitignore)

## Crew bonus (separate repo)
- `app.json`, one agent, one skill, weekly cron re-scan, dashboard page

## Specs (EARS)
scanner-classifier, resurrection-engine, graveyard-ui, mcp-server, crew-gravekeeper
