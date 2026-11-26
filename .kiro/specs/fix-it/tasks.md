# fix-it: tasks

Run these in Kiro CLI (`scripts/kiro/run-task.sh fix-it <n>`). Each task is test-first: write the named test, watch it fail, then make it pass. Each task ends with `pnpm test` and `pnpm secret-scan` green, a tick here, and one dated line in `KIRO_USAGE.md`.

Precondition for tasks 2 to 4: the owner has amended `.kiro/steering/security.md` and `.kiro/steering/product.md` as described in "Steering impact" in `requirements.md`. If they have not, stop and ask. Fake tokens in tests are built at run time (`"ghp_" + "a".repeat(36)`) so the secret scan stays green.

- [x] 1. Planning and redaction (pure): `lib/fix/redact.ts` (`redactToken`, `safeMessage`) and `lib/fix/plan.ts` (zod schemas, `parseRepoSlug`, `planFix`, `whyOf`, `prBody`, `commitMessage`, `branchName`). Test first in `tests/fix-redact.test.ts` (fast-check: token never survives, idempotent, never throws) and `tests/fix-plan.test.ts` (fast-check: only link spans change, unchanged files dropped, path and slug rules, `from` canonical and unique, PR body at most 60,000 characters) — R1.1 to R1.11
- [x] 2. GitHub writer: `lib/fix/github.ts` (`openFixPullRequest`, `FixError`, `ghUrl` origin assertion, default transport with `redirect: "manual"`, 10 s per call and 25 s overall, injected transport, clock and random). Test first in `tests/fix-github.test.ts` with a fake transport: happy path with the exact call sequence, no push permission, private and archived repositories, nothing to fix with no write calls, skipped paths, branch collision retry, failure after branch creation names the branch, redirect not followed, only GET, POST and PUT, token absent from every error, return value and log call — R2.1 to R2.15
- [x] 3. Route `app/api/fix/route.ts`: same-origin, own limiter (5 per 10 minutes per IP), 64 KB cap by header and by bytes read, zod, status mapping, `no-store` on every answer, no logging. Test first in `tests/fix-route.test.ts` with the writer mocked (same pattern as `tests/replacement-route.test.ts`): 403, 429 on the sixth request, 413 twice, validation cases that never echo the token, each status of R3.5, headers, `console` spy empty — R3.1 to R3.9
- [x] 4. UI: `lib/fix/panel.ts` (pure helpers), `components/graveyard/FixPanel.tsx` and the wiring in `components/Scanner.tsx` ("Open a pull request" in "Leave with the fix", `scanKind` and `scanRepo` recorded when the scan starts). Test first in `tests/fix-ui.test.ts` (helpers, plus a static check that the token never meets storage, cookie, URL or console). Then a browser pass (Playwright) for focus, Esc, keyboard, 390 px and 320 px, reduced motion, Daylight and the screen-reader labels, recorded in `docs/kiro-runs/` — R4.1 to R4.10
- [x] 5. Action source, build and summary: extend `ScanInput` with `kind: "docs"` and add `collectDocs` (not accepted by `ScanInputSchema`); add an optional `limit` to `rankMarkdownPaths`; write `action/src/{inputs,files,git,summary,run,index}.ts`, `action.yml`, `scripts/action-build.mjs`, the `action:build` script in `package.json`, and commit `action/dist/index.js` and `action/dist/package.json`. Test first in `tests/action-summary.test.ts`, `tests/action-files.test.ts`, `tests/action-git.test.ts`, `tests/action-core.test.ts` (fake transport) and `tests/action.test.ts` (runs the bundle on a temp workspace with a Sealed link; compares the committed bundle with a fresh build; `action.yml` fields) — R5.1 to R5.11
- [x] 6. Dogfood and docs: `.github/workflows/lychgate.yml` (pull requests touching Markdown, weekly, manual; `permissions: contents: read`; checkout `fetch-depth: 0`, `persist-credentials: false`; `uses: ./`), README sections "Fix it" and "GitHub Action" plus the status list, a read-only note in `packages/lychgate-mcp/README.md`, the `KIRO_USAGE.md` line. Test first in `tests/fix-it-docs.test.ts`. Run the Action once on this repo's own Markdown through the built bundle and record the result in `KIRO_USAGE.md` — R6.1 to R6.4

## Requirement map

| Requirement | Task | Test file |
| --- | --- | --- |
| R1.1 to R1.9 | 1 | `tests/fix-plan.test.ts` |
| R1.10, R1.11 | 1 | `tests/fix-redact.test.ts` |
| R2.1 to R2.15 | 2 | `tests/fix-github.test.ts` |
| R3.1 to R3.9 | 3 | `tests/fix-route.test.ts` |
| R4.1 to R4.10 | 4 | `tests/fix-ui.test.ts`, browser pass |
| R5.1, R5.2 | 5 | `tests/action.test.ts` |
| R5.3, R5.8, R5.9, R5.11 | 5 | `tests/action-summary.test.ts` |
| R5.4 | 5 | `tests/action-files.test.ts` |
| R5.5 | 5 | `tests/action-git.test.ts` |
| R5.6, R5.10 | 5 | `tests/action-core.test.ts` |
| R5.7 | 5 | `tests/action-summary.test.ts` |
| R6.1 to R6.4 | 6 | `tests/fix-it-docs.test.ts` |
