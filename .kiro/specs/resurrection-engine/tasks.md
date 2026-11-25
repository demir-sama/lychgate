# resurrection-engine: tasks

- [x] 1. `patchMarkdown(src, Map<canonical, replacement>)` rewrites only the exact source spans of targeted URLs (inline, image, definition, autolink, literal, HTML attr), escaping per syntax — property-tested
- [x] 2. `unifiedDiff(path, before, after)` git-style patch
- [x] 3. Default resurrection candidate = snapshot ≤ cite date (falls back to latest surviving copy, labelled)
- [ ] 4. Suggested live replacement (same-site search for moved pages; GitHub repo renames via API redirect)
- [x] 5. Preview pane: snapshot in a script-free sandboxed iframe (`if_` mode) next to the live evidence, plus the changed Markdown lines (`lib/patch/preview.ts`, property-tested)
- [x] 6. PR description generator (per-class summary, evidence, snapshot links) — in `components/Scanner.tsx`
- [ ] 7. Per-link choice UI: snapshot vs replacement vs keep (snapshot/keep done in the séance; replacement waits on task 4)
