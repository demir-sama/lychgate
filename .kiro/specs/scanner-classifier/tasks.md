# scanner-classifier: tasks

- [x] 1. Address policy `lib/net/ip.ts` (allow-list unicast; unwrap IPv4-mapped/compatible/NAT64) — R4.3
- [x] 2. URL shape + DNS guard `lib/fetch/guard.ts`; connect-time `createGuardedLookup` — R4.1–R4.5
- [x] 3. `safeFetch` with manual redirects, 8 s timeout, body cap, polite UA; `probeLink` HEAD→GET — R3.1–R3.3, R4.4
- [x] 4. `HostLimiter` 8/host, 24 global — R3.4
- [x] 5. Markdown link extraction with exact spans (mdast + GFM) — R1.3
- [x] 6. Sources: pasted, GitHub (tree + raw + commit history cite dates), website/sitemap — R1, R2
- [x] 7. Wayback CDX + Availability fallback + cache; `pickSnapshot` — R6
- [x] 8. RDAP via IANA bootstrap — R5.1, R5.4
- [x] 9. Signals: parked, not-found text, redirect-to-root; soft-404 sibling probe — R5.2, R5.4
- [x] 10. Pure `classify()` decision table — R5
- [x] 11. Engine async generator + NDJSON route with rate limit and time budget — R4.7, R7
- [x] 12. Tests: unit + fast-check properties (URL canonicalisation idempotent, snapshot picker, classifier never-dead-on-match, patch-only-targets) — testing.md
- [ ] 13. Shared cache across instances (Neon) for Wayback/RDAP results
- [ ] 14. Per-link cite date for website input (earliest Wayback capture of the citing page that contains the link)
- [ ] 15. Calibrate thresholds on a labelled sample (≥ 200 links) and report precision per class
- [ ] 16. Relative links in GitHub Markdown (resolve to blob URLs / repo files)
