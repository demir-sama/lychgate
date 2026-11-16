# How Lychgate is built (Kiro usage log)

This file is the honest record the Kiroween rules ask for: what was built in Kiro, how, and what was not.

## Spec-driven setup (16 Nov 2026)
- Steering files in `.kiro/steering/` (product, tech, structure, security, haunted design, testing)
- EARS requirement drafts for five specs in `.kiro/specs/`

## Milestone 1: scanner core + minimal UI (16 Nov 2026)
- **Not written in Kiro.** Kiro credits were still pending, so the milestone-1 code (fetch/SSRF layer, classifier, archive/RDAP/GitHub layers, streaming API, list UI, tests) was written by an AI coding assistant outside Kiro, working from the steering files and specs above.
- The `scanner-classifier` spec was then expanded to full EARS requirements, a design doc and a task list that match the code, with a requirement → test map. The `resurrection-engine` and `graveyard-ui` task lists record what is done and what is next.

## Planned Kiro usage (milestone 2 onward)
- Spec-driven tasks in Kiro IDE for the canvas graveyard, resurrect flow, report/badge, MCP server
- Hooks: run the property suite on save in `lib/classify/**`, dogfood a Lychgate scan of our own docs on `*.md` save via `lychgate-mcp`, pre-commit secret scan (`pnpm secret-scan`), update task checklists on completion
- `lychgate-mcp` registered in `.kiro/settings/mcp.json`
- Kiro Crew "Gravekeeper" app (separate repo)

## Other tools (disclosure)
- Wayback Machine and RDAP public APIs at runtime
- Video/voice/music tools for the demo will be listed here when used
