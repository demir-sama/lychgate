# resurrection-engine: design

## Replacement engine (task 4, R4)

```
POST /api/replacement ─┐
MCP suggest_replacement ┴─▶ lib/patch/replacement.ts  suggestReplacement(url, opts)
                              ├─ assertPublicUrl(url)           Sealed / unresolvable target: stop, no more fetches
                              ├─ github.com  → GitHubClient.repo()  GET /repos/{o}/{r}, only if canAfford()
                              ├─ redirect    → probeLink(url).finalUrl
                              ├─ sitemap     → GET /sitemap.xml (+ one child sitemap), rank, verify top 3
                              └─ verify(url) → analyzeTarget(...)  must say "living"
```

### Order and early exit
1. Pre-check the target with `assertPublicUrl`. If it is refused or does not resolve, return `null` without any other request.
2. `github.com` targets: rename (R4.1), then redirect (R4.3). They never use the sitemap.
3. Other hosts: redirect (R4.3), then sitemap (R4.4).
4. The first source that yields a Living candidate wins. A source that fails yields nothing (R4.10).

### Verification
`verify(url)` is injectable. The default builds one `ScanContext` per suggestion and returns `{ cls, title }` from `analyzeTarget`, so "Living" means exactly what the scanner means, including Sealed targets (no fetch) and soft-404 checks. `suggestReplacement` returns only a URL for which `verify` said `living`. That is the structural guarantee behind R4.7.

### GitHub rename
`GitHubClient.repo(owner, repo)` is a new public method over the existing `api()`: unauthenticated by default, rate-limit headers tracked, a 301 to `/repositories/{id}` followed by `safeFetch`. It returns `full_name`. If the name differs from the URL's `owner/repo` ignoring case, the new URL is `https://github.com/{full_name}` plus the original remaining path and query. Confidence 0.95.

### Redirect
`probeLink(url)` gives the redirect chain. The final URL is a candidate only if its registrable domain (tldts) equals the target's, it differs from the canonical target, and it is not the root of the site. A deep link that lands on the root is a soft-404, not a replacement. Confidence 0.9.

### Sitemap
- One fetch of `{origin}/sitemap.xml`, 512 KB, parsed with `htmlparser2` in XML mode (entity decoding, no new dependency), at most 5,000 `<loc>` values.
- `<sitemapindex>`: pick the one child on the same host whose URL best matches the target's slug tokens (ties keep the index's document order), fetch it once (same caps), do not go deeper. `.gz` children are skipped.
- Candidates are filtered to http(s), same registrable domain, not the target, not a root.
- `slugScore = 0.7 * jaccard(last segment tokens) + 0.3 * jaccard(all path tokens)`. Tokens: lower-cased path, extension dropped, split on non-letters/digits, length >= 2.
- Candidates under 0.4 are dropped. The top three by `(score desc, url asc)` are verified. When two or more are Living, the title of the target's latest Wayback copy is compared with each live title (`jaccard`), and the final score is `0.7 * slug + 0.3 * title`. Winner by `(final desc, url asc)`.
- Confidence `min(0.85, 0.3 + 0.55 * final)`.
- Sorting is on a copy with a total order, so sitemap order cannot change the result (R4.8).

### Files
| File | Role |
| --- | --- |
| `lib/patch/replacement.ts` | pure ranking helpers (`slugTokens`, `slugScore`, `rankCandidates`, `parseSitemap`, `mapGithubUrl`) and `suggestReplacement` |
| `lib/github/repo.ts` | `GitHubClient.repo()` |
| `lib/util/sameorigin.ts` | same-origin check for the route |
| `app/api/replacement/route.ts` | zod, same-origin, rate limit (own bucket, 30 per 10 min per IP; see Limiter below), 15 s budget |
| `packages/lychgate-mcp/src/tools.ts`, `server.ts` | `suggest_replacement` |

### Tests (requirement map in `tests/replacement.test.ts`)
- fast-check: never proposes a non-Living or Sealed URL (R4.7); ranking is invariant to input order (R4.8); a rename keeps the owner/repo mapping and the rest of the path (R4.1).
- Unit, mocked transport and resolver, no network: rename and case-only name, rate-limited client, redirect to root, cross-domain redirect, sitemap rank and verify cap, sitemap index one level, 5,000 URL cap, malformed XML, private candidate host, 15 s abort.
- Route: validation, cross-origin 403, rate limit, shape. MCP: tool list and a result with text then JSON.

## Choice UI (task 7, R5)

```
Seance ── "Look for a living replacement" ──▶ POST /api/replacement { url }   (one press, one request)
  │                                              └─ answer cached per URL in Scanner state (found[url])
  └─ choice: snapshot | replacement | keep ──▶ lib/patch/choice.ts
                                                  ├─ replacementMap(results, choices, found) ─▶ patchMarkdown ─▶ files / diff
                                                  ├─ patchPreview(docs, r, target)           ─▶ séance lines
                                                  └─ choice counts + rows                    ─▶ PR description
```

### State
`Scanner` holds `choice: Record<url, Choice>` (replaces the old `chosen` boolean; the grave card switch is `choice !== "keep"`, on means snapshot) and `found: Record<url, LookupState>` where `LookupState` is `idle | loading | { replacement, timedOut } | { error }`. Results are kept across séances, so a second opening shows the earlier answer and sends nothing (R5.2). `ReportView` keeps its own `found` and has no `choice` (R5.10).

### lib/patch/choice.ts (pure)
- `type Choice = "snapshot" | "replacement" | "keep"`.
- `defaultChoice(r)`: snapshot for Tombstone/Ghost/Zombie with a snapshot, else keep (R5.5).
- `targetFor(r, choice, found)`: the URL the choice points at, or `null` when the class is not resurrectable, the snapshot is missing, the replacement is missing, the choice is keep, or the target equals the link (R5.8).
- `replacementMap(results, choices, found)`: `Map<url, target>` from `targetFor`.
- `choiceSummary(results, choices, found)`: `{ snapshot: LinkResult[], replacement: Array<{ r, found }> }` for the PR description (R5.7).
- `reasonText(reason)`: "GitHub rename", "redirect on the same site", "same-site sitemap".

### Séance
Lookup button, result block (`role="status"`, so the screen reader hears it), then a `role="radiogroup"` of three native radio inputs (arrow keys and Space work with no code; disabled options keep their reason in text). Choosing an option applies it at once (the grave card switch follows) and picking snapshot or replacement over keep plays the rising motion. The footer has one "Done" button. A grave without a snapshot but with a resurrectable class now gets a séance too, because the lookup is useful there. The patch preview follows the selected option.

### Limiter
`/api/replacement` builds `new RateLimiter(30, 10 * 60_000)` of its own. `/api/scan` keeps 6 per 10 minutes.

### Tests
`tests/choice.test.ts` (fast-check): keep never maps; keys are a subset of resurrectable result URLs; a snapshot choice maps to the snapshot URL, a replacement choice to the found URL; a missing target maps nothing; no self-mapping; patching with the map changes only the mapped URLs. Route test: 30 allowed, the 31st is 429.
