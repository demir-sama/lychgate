# Lychgate

**Find every dead link, see how it died, and resurrect it in one click.**

Lychgate is a haunted graveyard for broken links, built for [Kiroween 2026](https://kiroween.devpost.com) (Costume Contest). Paste a website, a public GitHub repo or a Markdown list, and every link rises as one of:

| Spirit | Meaning |
| --- | --- |
| 🕯️ Living | Healthy |
| 🪦 Tombstone | 404 / 410 / the domain no longer resolves |
| 👻 Ghost | Soft-404: returns 200 but the content is gone |
| 🌫️ Drifted | Live, but no longer says what it said when it was cited |
| 🧟 Zombie | Domain parked or re-registered since it was cited (a security risk) |
| 🌀 Restless | Couldn't confirm (bot-blocked, timeout, server error), so not called dead |
| 🔒 Sealed | Refused: points at a private or internal address |

Each grave shows cause of death, evidence, confidence and the Wayback Machine snapshot closest **before** the date the link was added (for GitHub repos, read from git history). Pick which links to resurrect, then download the patched Markdown, a unified diff or a report.

## Status: milestone 1

Working today:
- Scanner for GitHub repos (README + up to 20 Markdown files, cite dates from git history, no token needed), web pages / sitemaps, and pasted Markdown or URL lists (≤ 300 links)
- SSRF-hardened fetch layer (DNS checked before every hop *and* at socket connect), HEAD→GET, 8 s timeouts, 8 requests per host
- Classifier for all seven states, Wayback CDX/Availability lookup, RDAP takeover checks
- Streaming results, minimal haunted list UI with Daylight mode, patched Markdown / diff / report downloads

Next: canvas graveyard view, resurrect/preview flow, PR description, shareable report + README badge, `lychgate-mcp` server, Kiro hooks. See `.kiro/specs/*/tasks.md`.

## Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest + fast-check
pnpm secret-scan  # run before every commit
```

Optional server-side env: `GITHUB_TOKEN` (raises GitHub API limits; never needed, never sent to the browser).

If your machine uses a fake-IP DNS proxy (every host resolves into 198.18.0.0/15), set `LYCHGATE_DEV_ALLOW_FAKE_IP=1` for local dev. It is ignored in production and on Vercel.

## API

`POST /api/scan` with one of:

```json
{ "kind": "github", "repo": "owner/repo" }
{ "kind": "site", "url": "https://example.com/post", "sitemap": false, "citeDate": "2019-05-01" }
{ "kind": "markdown", "text": "- https://example.com/", "citeDate": "2019-05-01" }
```

Response: `application/x-ndjson`, one event per line: `status`, `meta`, `result` (one per link), `done`.

## Security

- Only http/https on ports 80/443/8080/8443, no credentials in URLs, no internal hostnames
- Every DNS answer must be global unicast (blocks private, loopback, link-local, CGNAT, metadata IPs like 169.254.169.254 and fd00:ec2::254, IPv4-mapped/NAT64/6to4/Teredo tricks)
- Redirects followed manually and re-checked per hop; the dialled IP is re-validated at connect time (DNS rebinding)
- Body cap 512 KB, 300-link cap, per-IP rate limit, 270 s scan budget

## Built with Kiro

- `.kiro/steering/` covers product, tech, structure, security, haunted design and testing
- `.kiro/specs/` holds EARS requirements, design and task lists for the scanner, resurrection engine, graveyard UI, MCP server and gravekeeper crew
- See [KIRO_USAGE.md](KIRO_USAGE.md) for how each part was built, including what was not built in Kiro

## Credits

Snapshots: [Internet Archive Wayback Machine](https://web.archive.org/). Domain data: public RDAP via the IANA bootstrap registry.

## Licence

MIT © Demir ([demir-sama](https://github.com/demir-sama))
