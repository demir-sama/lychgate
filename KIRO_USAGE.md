# How Lychgate is built (Kiro usage log)

This file is the honest record the Kiroween rules ask for: what was built in Kiro, how, and what was not.

## Spec-driven setup (16 Nov 2026)
- Steering files in `.kiro/steering/` (product, tech, structure, security, haunted design, testing)
- EARS requirement drafts for five specs in `.kiro/specs/`

## Milestone 1: scanner core + minimal UI (16 Nov 2026)
- **Not written in Kiro.** Kiro credits were still pending, so the milestone-1 code (fetch/SSRF layer, classifier, archive/RDAP/GitHub layers, streaming API, list UI, tests) was written by an AI coding assistant outside Kiro, working from the steering files and specs above.
- The `scanner-classifier` spec was then expanded to full EARS requirements, a design doc and a task list that match the code, with a requirement → test map. The `resurrection-engine` and `graveyard-ui` task lists record what is done and what is next.

## Milestone 1b: haunted UI, hooks (16 Nov 2026)
- **Not written in Kiro.** Kiro credits had just arrived but the IDE/CLI was not yet set up on the build machine, so this pass was again written by an AI coding assistant outside Kiro, working from `haunted-design.md` and the `graveyard-ui` spec.
- Built: original SVG lychgate scene (doors open during a scan, fog density bound to health), arrival-order plot, grave cards with evidence, j/k keyboard walking, PR description export, Daylight theme as a dawn version of the scene.
- `graveyard-ui` requirements rewritten as full EARS (R1–R6) with a design doc and an updated task list.
- Added `.kiro/hooks/lychgate.json` (v1 schema): classifier and SSRF suites on save, `.env` write block (PreToolUse, exit 2), secret scan on Stop, spec-checklist sync on PostTaskExec. The dogfood-links hook is committed but disabled until `lychgate-mcp` exists. `tests/kiro.test.ts` checks that every hook points at real tests, scripts and pnpm scripts.

## Planned Kiro usage (milestone 2 onward)
- Spec-driven tasks in Kiro IDE for the canvas graveyard, resurrect flow, report/badge, MCP server
- Use the committed hooks in the Kiro IDE/CLI loop; enable the dogfood-links hook once `lychgate-mcp` ships
- `lychgate-mcp` registered in `.kiro/settings/mcp.json`
- Kiro Crew "Gravekeeper" app (separate repo)

## Other tools (disclosure)
- Wayback Machine and RDAP public APIs at runtime
- Fonts: Fraunces and IBM Plex (SIL Open Font License) via `next/font`
- Illustrations and icons: original SVG drawn for this project
- Video/voice/music tools for the demo will be listed here when used
