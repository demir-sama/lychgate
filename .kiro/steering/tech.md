# Tech

## Stack
- Next.js App Router + TypeScript on Vercel
- Scan in serverless route handlers with streaming results
- Neon Postgres for shareable reports (30-day retention), no auth
- Wayback CDX + Availability APIs (cached)
- RDAP for domain registration dates
- Public GitHub API for Markdown files and blame dates (unauthenticated, rate-limit aware)
- Property-based tests with fast-check for pure logic
- lychgate-mcp (stdio + npm) for scan_links, find_snapshot, classify_url, check_drift
- Separate public repo for Kiro Crew app "Gravekeeper" (bonus)

## Fetch rules
- HEAD then GET fallback, 8s timeout, redirect tracking, polite User-Agent
- SSRF guard: resolve DNS, block private/loopback/link-local/metadata IPs, re-check after redirects
- Cap 300 links per scan, concurrency 8 per host

## Honesty
Code is written through Kiro. Non-Kiro tools (ElevenLabs, Remotion, image assets) must be disclosed in KIRO_USAGE.md.
