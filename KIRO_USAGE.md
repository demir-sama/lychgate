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

- First production scan of a real repo (300 links) exposed two false results: GitHub rate-limited 58 links (429, shown as Restless), and a Wayback link was flagged Zombie because the archived page had a for-sale banner. Fixed with a per-host cooldown and bounded retry (R3.5) and an archived-link rule (R5.10), both test-first in `tests/backoff.test.ts`. The same live check showed Vercel's resolver answering `EBUSY` for an unregistered domain, so a DNS-over-HTTPS second opinion now confirms NXDOMAIN (R5.11, `tests/doh.test.ts`).

## Milestone 2: séance, sharing, sound (25 Nov 2026)
- **Not written in Kiro.** Kiro CLI 3.6.0 is now installed on the build machine and the repo has a custom agent for it, but the CLI's Google sign-in (device flow) still needs to be approved by the account owner, so this pass was again written by an AI coding assistant outside Kiro, working from the `graveyard-ui` and `resurrection-engine` specs and the steering files.
- Specs first: `graveyard-ui` R6 (sharing), R7 (séance) and R8 (sound) were written as EARS requirements before the code, then ticked in `tasks.md` with the test that covers each.
- Built: the séance (a script-free sandboxed Wayback frame next to today's evidence and the exact patch lines), shareable report pages and a README badge on Neon Postgres with server-recomputed health and 30-day deletion, synthesized Web Audio sound (off by default), resurrection motion, and a "lost web" demo preset.
- The first hosted run of that preset found a classifier gap: plus.google.com forwards to a blog post and was reported Living. Fixed test-first as `scanner-classifier` R5.12 (moved off-site → Drifted; same-path moves such as twitter.com → x.com stay Living), with a fast-check property in `tests/offsite.test.ts`.
- Kiro assets added for the next milestones: full EARS requirements, design and tasks for `mcp-server`; requirements for `crew-gravekeeper`; the `gravedigger` custom agent (`.kiro/agents/gravedigger.md`: steering as resources, test/typecheck commands allowed, `git push`, `curl` and `.env` writes denied); `scripts/kiro/run-task.sh` to run a spec task headless in Kiro CLI.

## Planned Kiro usage (milestone 3 onward)
- `mcp-server` tasks 1–7 in Kiro CLI with the `gravedigger` agent (`scripts/kiro/run-task.sh mcp-server <n>`)
- Use the committed hooks in the Kiro IDE/CLI loop; enable the dogfood-links hook once `lychgate-mcp` ships
- `lychgate-mcp` registered in `.kiro/settings/mcp.json`
- Kiro Crew "Gravekeeper" app (separate repo)

## Other tools (disclosure)
- Wayback Machine and RDAP public APIs at runtime
- Fonts: Fraunces and IBM Plex (SIL Open Font License) via `next/font`
- Illustrations and icons: original SVG drawn for this project
- Sound in the app: synthesized at runtime with the Web Audio API (no samples, nothing licensed)
- Database: Neon Postgres (free tier) for shared reports
- Video/voice/music tools for the demo will be listed here when used
