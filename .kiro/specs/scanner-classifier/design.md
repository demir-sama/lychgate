# scanner-classifier: design

## Pipeline

```
input ─▶ sources.ts ─▶ Target[] (canonical URL, occurrences, cite date)
                         │
                         ▼  per link, HostLimiter(8/host, 24 global)
                   analyze.ts
                    1. probeLink (HEAD→GET, safeFetch)       lib/fetch/http.ts
                    2. parseHtml → title/text                lib/classify/html.ts
                    3. signals: parked, not-found text,      lib/classify/signals.ts
                       redirect-to-root
                    4. soft-404 probe (random sibling path,
                       cached per directory, budget 60)
                    5. RDAP if cite date or NXDOMAIN         lib/domain/rdap.ts
                    6. drift: snapshot ≤ cite date vs live   lib/archive/wayback.ts
                       (deep links only, budget 40)
                    7. classify(evidence)  ← pure            lib/classify/classify.ts
                    8. snapshot for resurrectable classes
                         │
                         ▼
                   engine.ts (async generator) ─▶ route.ts (NDJSON stream) ─▶ UI
```

## Key decisions
- **Pure classifier.** All I/O happens before `classify(evidence)`. That keeps the decision table exhaustively unit- and property-testable (R5.6, R5.7).
- **Two-layer SSRF guard.** `assertPublicUrl` (shape + DNS, all answers must be public) runs before every hop for clear errors; `createGuardedLookup` is installed as undici's `connect.lookup`, so the address actually dialled is validated (R4.5). IP literals skip DNS in Node, which is why the pre-check also validates literals. Address policy is an allow-list (ipaddr.js `unicast` plus explicit extra blocks), not a deny-list.
- **Redirects followed manually** (`redirect: "manual"`) so every Location is re-validated (R4.4).
- **Restless, not dead.** Bot-blocking (403/429/999), 5xx and timeouts are common false positives in link checkers; we refuse to call them dead (R5.5).
- **Cite date from git without a token.** The commits API gives ≤ 100 commits per file in one call; raw.githubusercontent.com (outside the API quota) gives contents at each SHA. A per-URL binary search finds the introducing commit with O(log n) reads, memoised per SHA (R2.1). Optional `GITHUB_TOKEN` (server env only) raises limits; not required.
- **Live-scan corrections (16 Nov, after the first production scan of jlevy/the-art-of-command-line).** Two false positives: a Lambda resolver `EBUSY` was reported as a dead domain (it resolves), and an `http://` page whose every path returns the same stub was reported as a Ghost. Fixes: DNS retry + 30 s cache + only NXDOMAIN codes count as dead (R5.5); thin identical pages are Restless (R5.8); meta-refresh stubs are followed (R5.9).
- **Second production scan (16 Nov, same repo, 300 links).** 58 github.com links came back 429 (GitHub throttles unauthenticated HTML hits from shared cloud IPs), and a `web.archive.org/web/…` link was flagged Zombie from the archived page's for-sale banner. Fixes: `HostLimiter.cool()` pauses a host after 429/503 and `probeWithBackoff` retries at most twice (R3.5); archive URLs short-circuit to Living and skip parked/soft-404/drift checks (R5.10). The production resolver also answered `EBUSY` for a domain that does not exist, so transient DNS errors now get a DNS-over-HTTPS second opinion that can only confirm NXDOMAIN (R5.11, `lib/domain/doh.ts`).
- **Drift only on deep links.** Home pages are expected to change; flagging them created false positives in real scans (wireshark.org at 11%).
- **Snapshot without cite date = latest 200**, not earliest. The spec draft said "earliest"; for resurrection the latest good copy is the better candidate, and drift is only computed when a cite date exists. (Deviation recorded here deliberately.)
- **Caches** are per serverless instance (`TtlCache`, promise-valued so concurrent callers share requests). Shared caching (Neon/KV) is milestone 2+.
- **RDAP via IANA bootstrap**, not rdap.org, so "no RDAP service for this TLD" is distinguishable from "domain not registered".

## Thresholds (lib/classify/classify.ts `THRESHOLDS`)
| name | value | meaning |
|---|---|---|
| contentMatch | 0.80 | ≥ this similarity to the cited snapshot ⇒ Living, never dead |
| drift | 0.35 | < this ⇒ Drifted |
| softProbe | 0.90 | live vs random-sibling similarity for a Ghost |
| softProbeLength | 0.80 | length ratio needed with softProbe |

## Event schema (lib/scan/types.ts)
`status{message}` · `meta{source,total,found,capped,docs[],warnings[]}` · `result{LinkResult}` · `done{summary,ms}` · `error{message}`

## Testing map
| requirement | tests |
|---|---|
| R4 SSRF | tests/ip.test.ts, tests/guard.test.ts, tests/http.test.ts (incl. real-socket rebinding test) |
| R3 fetch | tests/http.test.ts, tests/limiter.test.ts, tests/backoff.test.ts (R3.5) |
| R5 classify | tests/classify.test.ts (incl. property R5.6), tests/signals.test.ts, tests/backoff.test.ts (R5.10), tests/doh.test.ts (R5.11) |
| R6 archive | tests/archive.test.ts (property: snapshot picker) |
| R1/R2 sources | tests/markdown.test.ts, tests/github.test.ts, tests/engine.test.ts |
| R7 streaming | tests/engine.test.ts, tests/route.test.ts |
