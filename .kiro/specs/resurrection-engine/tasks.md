# resurrection-engine: tasks

- [x] 1. `patchMarkdown(src, Map<canonical, replacement>)` rewrites only the exact source spans of targeted URLs (inline, image, definition, autolink, literal, HTML attr), escaping per syntax — property-tested
- [x] 2. `unifiedDiff(path, before, after)` git-style patch
- [x] 3. Default resurrection candidate = snapshot ≤ cite date (falls back to latest surviving copy, labelled)
- [x] 4. Suggested live replacement (R4.1–R4.13): GitHub repo renames via the API, same-domain redirects, same-site `sitemap.xml` ranking; only a Living candidate is suggested (`lib/patch/replacement.ts`, `POST /api/replacement`, MCP `suggest_replacement`; `tests/replacement.test.ts`, `tests/replacement-route.test.ts`, `tests/mcp-tools.test.ts`)
- [x] 5. Preview pane: snapshot in a script-free sandboxed iframe (`if_` mode) next to the live evidence, plus the changed Markdown lines (`lib/patch/preview.ts`, property-tested)
- [x] 6. PR description generator (per-class summary, evidence, snapshot links) — in `components/Scanner.tsx`
- [x] 7. Per-link choice UI: snapshot vs living replacement vs keep (R5.1–R5.10): on-demand "Look for a living replacement" in the séance (`components/graveyard/Seance.tsx`, `useLookups.ts`, also in `components/ReportView.tsx`), choice drives the preview, patched files, diff and PR description (`lib/patch/choice.ts`; `tests/choice.test.ts`, `tests/replacement-route.test.ts`); `/api/replacement` has its own 30 per 10 minutes limiter
