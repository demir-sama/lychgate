# fix-it: requirements (EARS)

Scope: two ways to make a repo link-healthy after a scan.

1. **"Fix it" pull request (R1 to R4).** After a GitHub repo scan, the person turns the replacements they chose (R5 of `resurrection-engine`: Wayback snapshot or living replacement) into a real pull request on the scanned repo, using their own GitHub token.
2. **Lychgate GitHub Action (R5, R6).** A Node 20 action that checks the Markdown in a checked-out workspace on every pull request and every week, so the links stay healthy.

Both reuse `lib/` unchanged where they can: the scanner engine, `patchMarkdown`, `lib/patch/choice.ts`, `GitHubClient` name rules and the SSRF guard.

## Steering impact (owner decision needed before task 2)

Two steering lines say the opposite of this spec. This spec does not edit steering; the owner does, then tasks 2 to 4 may start.

- `security.md`: "Public GitHub API only; no tokens in the default path" and "no storing user credentials". Fix it takes a user token for one request, on a non-default path, and stores nothing. The line needs an exception that names this route.
- `product.md`, Out of scope: "automatic PR creation". Fix it opens a pull request only when a person presses a button and supplies a token, so it is not automatic. The line should say so, to stop a future reader from deleting the feature.

If either file is unchanged when a task needs it, the agent stops and asks (agent rule: a change to the security steering).

## Definitions

- **Dead link**: a link whose class is Tombstone, Ghost or Zombie (the same set the UI counts as "dead or unsafe").
- **Replacement**: a pair `{ from, to }` where `from` is a canonical link URL from the scan and `to` is the URL the patch writes in its place.
- **Why**: `Wayback snapshot` when `to` is a Wayback Machine URL (`isArchiveUrl`), otherwise `living replacement`. It is derived on the server from `to`; the client does not send it.

## R1 Planning and redaction (pure, `lib/fix/plan.ts`, `lib/fix/redact.ts`)

- R1.1 The system shall provide `planFix(files, replacements)` where `files` is a list of `{ path, content }` and `replacements` a list of `{ from, to }`. It shall return, for each file whose content changes, `{ path, before, after, links }`, and, for the whole plan, the list of changed links `{ from, to, why, paths }`. It shall use `patchMarkdown` for every rewrite.
- R1.2 `planFix` shall change only the source spans of links whose canonical URL is a `from` value. Every other byte of every file shall be kept, including line endings, a byte-order mark and a missing final newline.
- R1.3 `planFix` shall drop every file whose content did not change, and shall list a replacement as a changed link only when at least one of its occurrences was rewritten in a kept file. A replacement whose `from` appears in no file shall not appear in the plan.
- R1.4 The system shall validate replacements: `from` and `to` shall both parse as http(s) URLs of at most 2,048 characters, `from` shall equal its own canonical form, no two replacements shall share a `from`, `to` shall differ from `from`, and there shall be between 1 and 300 replacements.
- R1.5 The system shall validate paths: between 1 and 20, no duplicates, each ending in `.md` or `.markdown` (case-insensitive), none with `..` as a segment, a leading `/`, a backslash, a NUL or other control character, an empty segment, or a `.git` segment, each at most 300 characters.
- R1.6 The system shall validate the repository slug with the existing GitHub name rules: exactly `owner/repo`, no URL, ref or path, both names matching `^[A-Za-z0-9_.-]{1,100}$`, neither `.` nor `..`, and the repo name not ending in `.git`.
- R1.7 The system shall derive the "why" of each link from `to` (see Definitions) and shall never accept it from the request.
- R1.8 `planFix` shall build the commit message of a file as `Lychgate: resurrect N dead links in <path>` and the pull request title as `Lychgate: resurrect N dead links`, where N is the number of distinct `from` URLs rewritten in that file, or in the whole plan. For N = 1 the text shall read `1 dead link`.
- R1.9 `planFix` shall build the pull request body as Markdown: a short intro, a table with one row per changed link (old link, new link, why, files), and the footer `_Opened with [Lychgate](https://github.com/demir-sama/lychgate)_`. Cell text shall have `|` and line breaks escaped, the old URL shall be in a code span so a dead address is not linked, and the whole body shall stay at or under 60,000 characters. WHEN rows do not fit, the body shall say how many more links the diff holds.
- R1.10 The system shall provide `redactToken(text, token?)` that removes the given token and anything shaped like a GitHub token (`gh[pousr]_` followed by 20 or more word characters, and `github_pat_` followed by 20 or more word characters) from any text, replacing each with `[redacted]`. It shall be idempotent and shall never throw.
- R1.11 The system shall have one function, `safeMessage(err, token)`, that turns any thrown value into a short message (at most 300 characters) passed through `redactToken`. Every error text that leaves the fix code, whether returned, thrown or logged, shall go through it.

## R2 GitHub writer (`lib/fix/github.ts`)

- R2.1 `openFixPullRequest({ repo, token, replacements, paths }, deps)` shall call only `https://api.github.com`. It shall build every URL through one function that asserts the origin is `https://api.github.com` and refuses anything else. No part of the request body shall choose a host.
- R2.2 The writer shall make its calls in this order, and no others: `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/git/ref/heads/{default_branch}`, one `GET /repos/{o}/{r}/contents/{path}?ref={head_sha}` per path, then (only when the plan is not empty) `POST /repos/{o}/{r}/git/refs`, one `PUT /repos/{o}/{r}/contents/{path}` per changed file in the order given, and `POST /repos/{o}/{r}/pulls`.
- R2.3 The writer shall send the token only as `Authorization: Bearer <token>` on those calls. It shall not follow redirects: a 301, 302, 307 or 308 shall end the request with a message that the repository moved and the person should scan its new name.
- R2.4 WHEN the repository answers 404, THEN the writer shall say the repository was not found or the token cannot see it. WHEN it answers 401, it shall say GitHub refused the token. IF the repository is private or archived, THEN the writer shall refuse with a plain message (Lychgate handles public repositories; archived repositories are read-only), and make no further call.
- R2.5 IF the repository answer shows the token has no push permission (`permissions.push` is not `true`), THEN the writer shall stop with a 403-style message that tells the person to fork the repository and scan the fork, and shall make no further call.
- R2.6 The writer shall read each listed file at the head SHA of the default branch, not at the branch name. It shall skip, and report in `skipped`, a path that is missing, is not a file, is larger than 1 MB (the contents API gives no content for it) or is not valid UTF-8. A skipped path shall not fail the request.
- R2.7 IF no file changes after `planFix`, THEN the writer shall stop with a 422-style "Nothing to fix" message before creating any branch, commit or pull request.
- R2.8 The writer shall create the branch `lychgate/fix-<YYYYMMDD>-<6 random base36 characters>` (UTC date, random from `crypto`) from the head SHA, with `POST /git/refs`. WHEN GitHub says the reference already exists, the writer shall try once more with a new suffix.
- R2.9 The writer shall write each changed file with `PUT /contents/{path}` carrying the blob `sha` it just read, the new content as base64, the branch, and the commit message from R1.8. It shall write files one after another, never in parallel.
- R2.10 The writer shall open the pull request from the new branch into the default branch, with the title and body from R1.8 and R1.9, and shall return `{ url, number, branch, files, links }`, where `files` is the list of changed paths and `links` the number of changed links.
- R2.11 The writer shall never force-push, never write to the default branch, never delete a branch, file or reference, never change a file that is not Markdown, and never call a method other than GET, POST or PUT.
- R2.12 IF a step fails after the branch exists, THEN the error shall name the branch and say what was already committed, and the writer shall leave the branch in place for the person to inspect or delete.
- R2.13 Each GitHub call shall have a 10 second timeout, and the whole operation shall stop after 25 seconds. A timeout shall give a 504-style message. A GitHub 403 or 429 that reports a spent rate limit shall give a 429-style message with the reset time.
- R2.14 The writer shall take its transport (a `fetch`-shaped function), clock and random source as injected dependencies, so tests make no network call.
- R2.15 The token shall not appear in any thrown error, any returned value, any log line or any URL. Messages shall come from `safeMessage` (R1.11), and shall not repeat a GitHub response body beyond its `message` field, truncated and redacted.

## R3 Route (`POST /api/fix`)

- R3.1 The route shall accept only same-origin requests (`isSameOrigin`) and answer others 403 before reading the body.
- R3.2 The route shall apply its own rate limiter bucket of 5 requests per 10 minutes per IP, separate from `/api/scan`, `/api/replacement` and `/api/report`, and answer 429 with `Retry-After`.
- R3.3 The route shall refuse a body larger than 64 KB with 413, judged by `Content-Length` when present and by the bytes actually read, and shall not parse a larger body.
- R3.4 The route shall validate the body with zod: `{ repo, token, replacements, paths }` as in R1.4 to R1.6, with `token` matching `^[A-Za-z0-9_]{20,255}$` (so it can never carry a space, a line break or other header-breaking character). Unknown keys shall be refused. A validation message shall name the field and never repeat the submitted value.
- R3.5 The route shall answer: 200 with `{ url, number, branch, files, links, skipped }` on success; 400 for a bad body; 401 for a refused token; 403 for no push permission, a private repository or an archived one; 404 for a missing repository; 413 for a large body; 422 for "Nothing to fix"; 429 for either rate limit; 502 for another GitHub failure; 504 for a timeout. Every answer shall be JSON with `{ error }` on failure.
- R3.6 Every answer, success or failure, shall carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- R3.7 The route shall stop at 25 seconds (`maxDuration` 30) and shall cancel the GitHub calls when the client disconnects.
- R3.8 The route shall not write the token or the request body to any log, and shall not call `console.*` with an error or request object. Every error text in a response shall come from `safeMessage`.
- R3.9 The route shall not store the token, in memory beyond the request, in a database, in a cache key or in the rate limiter key.

## R4 "Open a pull request" panel (UI)

- R4.1 WHERE a scan of a public GitHub repository has finished and at least one file has a link marked for resurrection, the "Leave with the fix" region shall show an "Open a pull request" button. It shall not appear for website or Markdown scans. WHEN the scanned input named a branch or path (a `/tree/<ref>` address), the region shall say the pull request targets the default branch and shall not offer the button.
- R4.2 WHEN the button is pressed, the page shall open a panel (a modal `dialog` with a title) and move focus to its first field. Esc shall close it and return focus to the button. Tab shall stay inside the panel while it is open.
- R4.3 The panel shall hold: a password-type token field with a visible label, `autocomplete="off"` and spell checking off; one line saying which token it needs (fine-grained, one repository, Contents read and write, Pull requests read and write), with a link to GitHub's fine-grained token page; one line saying the token passes through the Lychgate server for this one request and is not stored; and the number of links and files that will change.
- R4.4 The token shall live only in component state. The page shall never put it in `localStorage`, `sessionStorage`, a cookie, the URL, a query string or any `console` output, and shall clear it when the request ends (success or failure) and when the panel closes.
- R4.5 The page shall send `POST /api/fix` with the repository slug recorded when the scan started (not the current value of the input), the replacement map from `replacementMap` for the files that changed, and the paths of those files (at most 20). WHEN the body would exceed 64 KB, the panel shall say so in words and offer the existing downloads instead of sending it.
- R4.6 WHILE the request runs, the submit button shall be disabled and a polite live region shall say the pull request is being opened.
- R4.7 WHEN the route answers 200, the panel shall show a link to the pull request that opens in a new tab with `rel="noopener"`, and the line "The dead rest; review the pull request." The link shall receive focus.
- R4.8 WHEN the route answers with an error, the panel shall show the error in words in an alert region, keep the panel open, leave the token field empty and allow another try. A 403 for missing push permission shall say to fork the repository and scan the fork.
- R4.9 WHEN no token is given, the existing downloads (patched Markdown, unified diff, copy PR description) shall stay available and unchanged.
- R4.10 The panel shall be reachable and usable with the keyboard alone, label every control, work at 390 px and 320 px wide with no horizontal scroll, respect `prefers-reduced-motion` and Daylight mode, keep text contrast at or above 4.5:1, and use the haunted tone of `haunted-design.md` without hiding the evidence.

## R5 GitHub Action

- R5.1 The repository root shall have `action.yml` with `name: Lychgate link check`, `runs.using: node20` and `runs.main: action/dist/index.js`, plus a description, the author `Demir (demir-sama)` and the inputs and outputs below.
- R5.2 `action/dist/index.js` shall be a single committed esbuild bundle of `action/src/index.ts`, built by `pnpm action:build` (`scripts/action-build.mjs`) with the same `createRequire` banner as `scripts/mcp-build.mjs`. The build shall also write `action/dist/package.json` with `{ "type": "module" }`. A test shall fail when the committed bundle differs from a fresh build.
- R5.3 The action shall have these inputs: `paths` (default `**/*.md`; globs separated by new lines or commas; `!` excludes), `max-files` (default `20`, at most 50), `fail-on` (default `tombstone,zombie`; any of `tombstone`, `ghost`, `drifted`, `zombie`, `restless`, `sealed`; empty means never fail), and `cite-dates` (default `git`; `git` or `none`).
- R5.4 The action shall read Markdown files (`.md`, `.markdown`) from `GITHUB_WORKSPACE` (or the working directory) that match `paths`, skipping `node_modules`, `.git`, `vendor`, `dist`, `build` and `third_party`, ranked README first, then `docs/`, then shallow paths, and cut at `max-files`. It shall not follow symlinks and shall not read a file whose real path is outside the workspace.
- R5.5 WHEN `cite-dates` is `git`, the action shall date each link with the local git history (`git log` for the file, then the same search as `citeDatesFromHistory`, reading each commit's copy with `git show`), and shall run git with an argument array, never through a shell. WHERE the clone is shallow or git fails, the action shall say so in the summary (and that `fetch-depth: 0` fixes it) and continue without dates.
- R5.6 The action shall check the links with the same engine as `/api/scan` and the MCP `scan_links` tool (`runScan`, including the SSRF guard on every fetch), at most 300 links, entirely inside the runner. It shall not call the Lychgate website and shall need no secret and no token.
- R5.7 The action shall write a job summary to `GITHUB_STEP_SUMMARY`: the health score, the counts per class, and a table of dead and drifted links (and links of any `fail-on` class) with `file:line`, the cause, the confidence and the closest Wayback snapshot. It shall also list the warnings of the scan. A Zombie row shall say it is a security risk. The summary shall stay under 900 KB and say how many rows it left out.
- R5.8 The action shall set the outputs `health` (0 to 100) and `dead` (the number of Tombstone, Ghost and Zombie links) through `GITHUB_OUTPUT`.
- R5.9 The action shall exit 1 when and only when at least one link has a class listed in `fail-on`. WHEN an input is invalid, it shall exit 2 with a message that names the input. A budget that ran out shall make unfinished links Restless, which fails the run only if `restless` is in `fail-on`.
- R5.10 The action shall never write to the workspace or the repository. Its only writes shall be to `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY`, and to standard output.
- R5.11 The decision to fail (`failDecision`) and the summary renderer (`renderSummary`) shall be pure functions with no I/O.

## R6 Dogfood and documentation

- R6.1 The repository shall have `.github/workflows/lychgate.yml` that runs the action (`uses: ./`) on pull requests that touch Markdown, once a week, and on manual dispatch, with `permissions: contents: read`, a checkout with `fetch-depth: 0` and `persist-credentials: false`, a 10 minute timeout and no secrets.
- R6.2 `README.md` shall gain a "Fix it" section (what the pull request contains, the token scopes, that the token is used for one request and not stored, the fallback downloads) and a "GitHub Action" section (a copy-paste workflow, the inputs and outputs, how `fail-on` works), and the status list shall mention both.
- R6.3 `packages/lychgate-mcp/README.md` shall say that the server stays read-only and never opens pull requests, and point to Fix it and the Action for writing fixes.
- R6.4 `KIRO_USAGE.md` shall gain a dated line per finished task, and `README.md` shall not claim a feature before its task is ticked.
