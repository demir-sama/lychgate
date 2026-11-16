# resurrection-engine: tasks

- [x] 1. `patchMarkdown(src, Map<canonical, replacement>)` rewrites only the exact source spans of targeted URLs (inline, image, definition, autolink, literal, HTML attr), escaping per syntax — property-tested
- [x] 2. `unifiedDiff(path, before, after)` git-style patch
- [x] 3. Default resurrection candidate = snapshot ≤ cite date (falls back to latest surviving copy, labelled)
- [ ] 4. Suggested live replacement (same-site search for moved pages; GitHub repo renames via API redirect)
- [ ] 5. Preview pane (snapshot in sandboxed iframe / text diff vs live)
- [ ] 6. PR description generator (per-class summary, evidence, snapshot links)
- [ ] 7. Per-link choice UI: snapshot vs replacement vs keep
