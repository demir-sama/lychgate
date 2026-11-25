# mcp-server: tasks

Run these in Kiro (CLI: `kiro-cli chat --agent gravedigger`, or the IDE spec view). Each task ends with `pnpm test` green.

- [x] 1. Scaffold `packages/lychgate-mcp` (package.json with `bin`, MIT, README with the Kiro `mcp.json` snippet); add `@modelcontextprotocol/sdk`; esbuild script `pnpm mcp:build` → `dist/index.js` — R1.1–R1.3
- [x] 2. `classify_url` and `find_snapshot` tools with zod input and two-block output — R2.2, R2.3, R2.5, R2.6
- [x] 3. `check_drift` tool — R2.4
- [x] 4. `scan_links` with the four input kinds, worst-first non-living results, 300-link/120 s caps — R2.1, R3.4
- [x] 5. Path sandbox for `scan_links { path }` with a fast-check property test (never escapes cwd) — R3.2
- [x] 6. Smoke test `tests/mcp.test.ts` over stdio (list tools; Sealed target) — R4.3
- [x] 7. Enable the server in `.kiro/settings/mcp.json` and the `dogfood-doc-links` hook; run it on README.md and KIRO_USAGE.md and record what it found in KIRO_USAGE.md — R4.1, R4.2

Task 7 was built in Kiro CLI by the `gravedigger` agent.
