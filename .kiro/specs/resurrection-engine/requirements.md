# resurrection-engine — requirements (EARS draft)

Status: day-1 scaffold from /workspace/hackathons/kiroween/spec.md. Expand in Kiro once credits land.

## Ubiquitous
The system shall classify and present link health without requiring user accounts.

## Event-driven
WHEN a user submits a target (URL, public GitHub repo, or Markdown list), the system shall stream classification results for up to 300 links.

## State-driven
WHILE a scan is running, the system shall expose living, tombstone, ghost, drifted, and zombie counts.

## Unwanted
IF a fetch target resolves to a private, loopback, link-local, or metadata address, THEN the system shall refuse the request and record an SSRF block.

## Optional
WHERE a Wayback snapshot exists at or before the citation date, the system shall offer it as the default resurrection candidate.

## R4 Suggested live replacement (task 4)

Scope: for a link that is dead, drifted or hijacked, offer one live URL that the same content probably moved to. The suggestion is a proposal only. The default resurrection candidate stays the Wayback snapshot (task 3), and nothing is applied without the person choosing it (task 7).

- R4.1 WHEN asked for a replacement for a URL on `github.com` whose first two path segments name a repository, the system shall request `GET https://api.github.com/repos/{owner}/{repo}` through the guarded fetch, and WHEN the returned `full_name` differs from `{owner}/{repo}` (compared ignoring case) it shall propose the same URL with those two segments replaced and the rest of the path and the query kept (for example `/blob/main/x` stays `/blob/main/x`), with reason `github-rename`.
- R4.2 WHILE `GitHubClient.canAfford()` is false, the system shall not call the GitHub API and shall continue with the other sources.
- R4.3 WHEN the target's redirect chain ends at a URL on the same registrable domain that differs from the target and is not the site root, the system shall propose that final URL with reason `redirect`.
- R4.4 WHEN neither R4.1 nor R4.3 produced a Living candidate and the target is not on `github.com`, the system shall fetch `/sitemap.xml` of the target's origin and rank the URLs of the same registrable domain by path-slug similarity to the target (and by page-title similarity among Living candidates), and propose the best Living one with reason `sitemap`.
- R4.5 The sitemap lookup shall make one fetch of `/sitemap.xml` (512 KB cap) and read at most 5,000 URLs. IF that document is a sitemap index, THEN the system shall follow at most one level, fetching at most one child sitemap on the same host, chosen by slug similarity to the target.
- R4.6 The system shall verify at most three sitemap candidates, best ranked first, with the scanner's own probe (`analyzeTarget`), and shall propose only a candidate that classifies as Living.
- R4.7 IF a candidate is Sealed, not Living, equal to the target, a site root, or outside the target's registrable domain (for sitemap candidates), THEN the system shall not propose it.
- R4.8 The ranking shall be deterministic: the same target and the same set of candidate URLs shall give the same order whatever order the sitemap listed them, with ties broken by URL.
- R4.9 The system shall return `{ url, reason, confidence }` with `reason` one of `github-rename`, `redirect`, `sitemap` and `confidence` between 0 and 1, or `null` when there is nothing to propose.
- R4.10 IF a source fails (rate limit, timeout, malformed XML, DNS error, non-200), THEN the system shall treat it as having no candidate and continue; it shall not turn the failure into an error for the caller.
- R4.11 Every request shall go through the SSRF guard (`safeFetch` / `probeLink`). The system shall use no external search API, no paid service and no secret beyond the optional server-side `GITHUB_TOKEN`.
- R4.12 `POST /api/replacement` with `{ url }` shall validate the body with zod, accept only same-origin requests, apply a per-IP rate limit (own bucket, see R5.9), stop after 15 seconds, and answer `{ replacement, timedOut }`.
- R4.13 The MCP server shall expose `suggest_replacement { url }` (read-only, same text-then-JSON result shape as the other tools) that returns the same suggestion.

## R5 Per-link choice (task 7)

Scope: for each dead or drifted link the person picks what the patch does: bring back the Wayback snapshot, point at a living replacement, or keep the link as it is. The replacement lookup runs only when asked.

- R5.1 The séance shall offer a button "Look for a living replacement" for a Tombstone, Ghost, Zombie or Drifted link. WHEN pressed, the system shall send exactly one `POST /api/replacement { url }` for that link. The system shall not call it during a scan, when a grave or the séance opens, or for any link the person did not ask about.
- R5.2 WHILE the lookup runs, the button shall be disabled and the séance shall say so in a polite live region. A repeat press for the same link in the same session shall reuse the first answer and send no request.
- R5.3 WHEN the lookup returns a replacement, the séance shall show its URL, its reason in plain words (GitHub rename, redirect, or same-site sitemap) and its confidence as a percentage. WHEN it returns `null`, the séance shall say "No living replacement found" (with "the lookup ran out of time" added when `timedOut` is true). IF the request fails or is rate limited, THEN the séance shall show the plain error and allow another press.
- R5.4 Where the scan came from a patchable source (the document contents are known), the séance shall offer a three-way choice for the link: Wayback snapshot, living replacement, keep as is. The snapshot option is disabled when there is no snapshot. The replacement option is disabled until a replacement has been found. Exactly one option is selected at a time, and each is reachable and selectable from the keyboard.
- R5.5 The default choice shall be the snapshot for Tombstone, Ghost and Zombie links that have one, and keep for everything else. The system shall never select the replacement without the person choosing it.
- R5.6 The patch preview in the séance, the patched files, the unified diff and the PR description shall all follow the same per-link choice. A link set to keep shall not change. A link set to replacement shall change to the replacement URL only.
- R5.7 The PR description shall state how many links point at a living replacement and how many at a snapshot, and list each replacement with its URL, its reason and its confidence. WHEN no link uses a replacement it shall not mention replacements.
- R5.8 The pure mapping from choices to the `Map<url, replacement>` that `patchMarkdown` takes shall live in `lib/patch/choice.ts`. It shall map only links whose class may be resurrected, shall ignore a choice that has no target (a missing snapshot or an unfound replacement), and shall never map a link to itself.
- R5.9 `POST /api/replacement` shall use its own rate limiter bucket of 30 requests per 10 minutes per IP, separate from `/api/scan`, because each press is one user action on one link.
- R5.10 A shared report page is read-only. It may offer the lookup button and show the result, but it shall not offer the choice.
