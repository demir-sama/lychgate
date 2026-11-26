# Lychgate

**Find every dead link, see how it died, and resurrect it in one click.**

Lychgate is a haunted graveyard for broken links, built for [Kiroween 2026](https://kiroween.devpost.com) (Costume Contest). Paste a website, a public GitHub repo or a Markdown list, and every link rises as one of:

| Spirit | Meaning |
| --- | --- |
| Living | Healthy: the lantern is lit |
| Tombstone | 404 / 410 / the domain no longer resolves |
| Ghost | Soft-404: returns 200 but the content is gone |
| Drifted | Live, but no longer says what it said when it was cited |
| Zombie | Domain parked or re-registered since it was cited (a security risk) |
| Restless | Couldn't confirm (bot-blocked, timeout, server error), so not called dead |
| Sealed | Refused: points at a private or internal address |

Each grave shows cause of death, evidence, confidence and the Wayback Machine snapshot closest **before** the date the link was added (for GitHub repos, read from git history). Pick which links to resurrect, then download the patched Markdown, a unified diff, a ready PR description or a report.

**Live:** https://lychgate-taupe.vercel.app
**Demo video:** https://www.youtube.com/watch?v=PhRWQrvAeDo

## Status: milestone 3

Working today:
- Scanner for GitHub repos (README + up to 20 Markdown files, cite dates from git history, no token needed), web pages / sitemaps, and pasted Markdown or URL lists (≤ 300 links)
- SSRF-hardened fetch layer (DNS checked before every hop *and* at socket connect), HEAD→GET, 8 s timeouts, 5 redirects, 512 KB body cap, 8 requests per host
- Classifier for all seven states, Wayback CDX/Availability lookup, RDAP takeover checks
- Streaming haunted UI: an original SVG lychgate whose doors open while it scans, fog that thickens as health drops, a plot where each link rises from the ground, worst-first graves with evidence, j/k keyboard walking, and a Daylight mode (high contrast, no motion)
- Resurrect switches, patched Markdown / unified diff / PR description / report
- **The séance:** hold a dead link and its last good copy side by side (a script-free sandboxed Wayback frame next to today's status, landing URL and drift) and see the exact lines the patch will change before you resurrect it (`s` on a focused grave)
- **Share the graveyard:** a public read-only report page and a README health badge, stored in Neon Postgres for 30 days, then deleted
- Original synthesized sound (Web Audio, off by default): a lantern chime for the living, a distant bell for each tombstone, a falling wail for ghosts
- "Try the lost web": a preset of world-famous dead links (GeoCities, Google+, Vine, Google Reader…) cited in 2012
- **A living replacement:** in the séance, ask for a live replacement (a GitHub repo rename, a same-site redirect or the site's own sitemap, verified Living before it is offered), then choose per link: Wayback snapshot, living replacement, or keep as is. The choice drives the patch, diff and PR description
- **`lychgate-mcp`:** an MCP server (stdio) with `scan_links`, `classify_url`, `find_snapshot`, `check_drift` and `suggest_replacement`, so Kiro or any MCP client can check docs for dead links. Build with `pnpm mcp:build`; `.kiro/settings/mcp.json` already points at it
- Kiro hooks: the gravedigger agent scans every Markdown file it writes through `lychgate-mcp` (`postToolUse`), plus the test suites, `.env` write block, secret scan and spec checklist sync in `.kiro/hooks/lychgate.json`
- **Fix it:** after a GitHub repo scan, open a pull request that applies the links you chose to resurrect (see [Fix it](#fix-it))
- **GitHub Action:** check the Markdown of your own repo on every pull request and every week, inside the runner (see [GitHub Action](#github-action))
- **Gravekeeper**, a Kiro Crew app that walks your watched repos weekly with Lychgate: [demir-sama/gravekeeper](https://github.com/demir-sama/gravekeeper)

## Fix it

After a scan of a public GitHub repository, "Open a pull request" in "Leave with the fix" turns the links you chose to resurrect (Wayback snapshot or living replacement) into a pull request on the default branch of that repository. It creates a branch named `lychgate/fix-<date>-<suffix>`, commits each changed Markdown file, and opens the pull request with a table of every old link, its new address and why. It never writes to the default branch, never force-pushes and never deletes anything.

- **Token:** a fine-grained GitHub token limited to that one repository, with Contents read and write and Pull requests read and write. For a repository you cannot push to, fork it and scan the fork.
- **Your token is used for one request and not stored.** It goes through the Lychgate server to `api.github.com` only, and is never logged, cached or put in a URL.
- **Without a token** the downloads stay as they were: patched Markdown, unified diff and the PR description.
- Private and archived repositories are refused. The route is `POST /api/fix`, limited to 5 requests per 10 minutes per IP.

## GitHub Action

Lychgate also runs as an Action. It reads the Markdown in the checked-out workspace, checks the links inside the runner (same engine and SSRF guard as the site), writes a job summary and sets outputs. It needs no token and no secret, and writes nothing to your repository.

```yaml
name: Links
on:
  pull_request:
    paths: ["**/*.md"]
  schedule:
    - cron: "17 6 * * 1"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  links:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: demir-sama/lychgate@main
```

Inputs:

| Input | Default | Meaning |
| --- | --- | --- |
| `paths` | `**/*.md` | Globs separated by new lines or commas; start one with `!` to exclude |
| `max-files` | `20` | Most files to read (1 to 50), README first, then `docs/` |
| `fail-on` | `tombstone,zombie` | Classes that fail the run: `tombstone`, `ghost`, `drifted`, `zombie`, `restless`, `sealed`. Empty never fails |
| `cite-dates` | `git` | `git` dates each link from local history (needs `fetch-depth: 0`); `none` skips dating |

Outputs: `health` (0 to 100) and `dead` (tombstone, ghost and zombie links).

The run exits 1 when at least one link has a class listed in `fail-on`, and 2 when an input is invalid. Links the budget did not reach count as restless, which fails only if `restless` is in `fail-on`. This repository runs the Action on itself in `.github/workflows/lychgate.yml`.

## Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest + fast-check
pnpm secret-scan  # run before every commit
```

Optional server-side env: `GITHUB_TOKEN` (raises GitHub API limits; never needed, never sent to the browser) and `DATABASE_URL` (Neon Postgres, turns on shared reports). Create the table with:

```sql
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY, source text NOT NULL, health int NOT NULL,
  summary jsonb NOT NULL, results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
```

If your machine uses a fake-IP DNS proxy (every host resolves into 198.18.0.0/15), set `LYCHGATE_DEV_ALLOW_FAKE_IP=1` for local dev. It is ignored in production and on Vercel.

## API

`POST /api/scan` with one of:

```json
{ "kind": "github", "repo": "owner/repo" }
{ "kind": "site", "url": "https://example.com/post", "sitemap": false, "citeDate": "2019-05-01" }
{ "kind": "markdown", "text": "- https://example.com/", "citeDate": "2019-05-01" }
```

Response: `application/x-ndjson`, one event per line: `status`, `meta`, `result` (one per link), `done`.

`POST /api/replacement` with `{ "url": "https://…" }` (same-origin) returns `{ replacement: { url, reason, confidence } | null, timedOut }`.

`POST /api/report` with `{ source, results }` saves a finished scan and returns `{ id, path: "/r/<id>", badge: "/api/badge/<id>" }`. The server recomputes the health score itself.

## Security

- Only http/https on ports 80/443/8080/8443, no credentials in URLs, no internal hostnames
- Every DNS answer must be global unicast (blocks private, loopback, link-local, CGNAT, metadata IPs like 169.254.169.254 and fd00:ec2::254, IPv4-mapped/NAT64/6to4/Teredo tricks)
- Redirects followed manually and re-checked per hop; the dialled IP is re-validated at connect time (DNS rebinding)
- Body cap 512 KB, 300-link cap, per-IP rate limit, 270 s scan budget

## Built with Kiro

- `.kiro/steering/` covers product, tech, structure, security, haunted design and testing
- `.kiro/specs/` holds EARS requirements, design and task lists for the scanner, resurrection engine, graveyard UI, MCP server and gravekeeper crew
- `.kiro/agents/gravedigger.json` is the Kiro CLI custom agent that built milestone 3 one spec task at a time, test-first: steering and spec as resources, the `@lychgate` MCP tools, `postToolUse` and `stop` hooks, and `git push`, `git commit`, `curl` and `.env` access denied; `scripts/kiro/run-task.sh <spec> <n>` runs a task headless and `docs/kiro-runs/` keeps every transcript
- `.kiro/hooks/lychgate.json` (v1 schema) wires the test suites, a `.env` write block, the secret scan and spec-checklist sync into the agent loop; `tests/kiro.test.ts` keeps the hooks pointing at real files and scripts
- See [KIRO_USAGE.md](KIRO_USAGE.md) for how each part was built, including what was not built in Kiro

## Credits

Snapshots: [Internet Archive Wayback Machine](https://web.archive.org/). Domain data: public RDAP via the IANA bootstrap registry.

## Licence

MIT © Demir ([demir-sama](https://github.com/demir-sama))
