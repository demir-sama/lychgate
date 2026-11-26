# fix-it: design

Two features share one idea: the scanner already knows what to change, so write the change where the person works. Fix it writes to GitHub with the person's token. The Action writes nothing and only reports.

## Fix it (R1 to R4)

### Data flow

```
Scanner (GitHub scan finished)
  replacementMap(results, choices, found)        lib/patch/choice.ts  (unchanged)
  + paths of docs whose patch changed             (<= 20, .md/.markdown)
  + repo slug recorded when the scan started
        │  "Open a pull request" panel (FixPanel)  token in component state only
        ▼
POST /api/fix  { repo, token, replacements:[{from,to}], paths }
  1. isSameOrigin                         403
  2. limiter 5 / 10 min / IP (own bucket) 429
  3. body <= 64 KB (header + bytes read)  413
  4. zod (FixInputSchema)                 400
  5. openFixPullRequest(input, { transport, now, random, signal 25 s })
        │
        ▼  only https://api.github.com, Bearer token, redirect: "manual"
  GET  /repos/{o}/{r}                          exists, public, not archived, permissions.push
  GET  /repos/{o}/{r}/git/ref/heads/{branch}   head SHA
  GET  /repos/{o}/{r}/contents/{path}?ref=SHA  x paths  (content + blob sha)
       planFix(files, replacements)            pure; empty plan -> 422, no write
  POST /repos/{o}/{r}/git/refs                 lychgate/fix-YYYYMMDD-xxxxxx at SHA
  PUT  /repos/{o}/{r}/contents/{path}          x changed files, sequential, blob sha + branch
  POST /repos/{o}/{r}/pulls                    title, body, head = branch, base = default
        ▼
  { url, number, branch, files, links, skipped }      Cache-Control: no-store
```

### Why head SHA, not the branch name
The scan read the repo earlier, possibly minutes ago. Reading every file at one SHA gives one consistent snapshot, and the branch is created from that same SHA, so the blob `sha` values sent with each `PUT` match the files the plan was built on. If someone pushes in between, the pull request still applies cleanly against what we read, and GitHub shows any conflict in the normal way.

### Modules

| File | Role |
| --- | --- |
| `lib/fix/redact.ts` | `redactToken(text, token?)`, `safeMessage(err, token)` |
| `lib/fix/plan.ts` | zod schemas (`FixInputSchema`, `parseRepoSlug`, path and replacement rules), `planFix`, `whyOf`, `prBody`, `commitMessage`, `branchName` |
| `lib/fix/github.ts` | `openFixPullRequest`, `FixError { status, message }`, `ghUrl` (origin assert), default transport |
| `app/api/fix/route.ts` | origin, limiter, size cap, zod, status mapping, headers |
| `lib/fix/panel.ts` | pure UI helpers: `fixPreview(docs, replacements)`, `bodyBytes`, `describeFixError`, `isScanOfDefaultBranch` |
| `components/graveyard/FixPanel.tsx` | the dialog; `components/Scanner.tsx` mounts it in "Leave with the fix" |

### planFix (R1)
Input: `files: Array<{ path, content }>`, `replacements: Array<{ from, to }>`. It builds `Map<from, to>` and calls `patchMarkdown(content, map)` per file. `patchMarkdown` already rewrites only the exact source spans and escapes per syntax, so R1.2 follows from it, and the property test proves it end to end (byte equality outside the changed spans, including CRLF, BOM and no final newline).

Output: `{ files: Array<{ path, before, after, links: string[] }>, links: Array<{ from, to, why, paths }> }`. `files` holds only changed files (R1.3). `links` holds only `from` values with at least one rewrite. `why` comes from `whyOf(to)`: `isArchiveUrl(to) ? "Wayback snapshot" : "living replacement"` (R1.7).

PR body (R1.9), roughly:

```
## Resurrect dead links

Lychgate found N dead links in this repository and points each at where it can still be read.

| Was | Now | Why | Files |
|---|---|---|---|
| `https://old.example/a` | https://web.archive.org/web/2019.../https://old.example/a | Wayback snapshot | README.md |

_Opened with [Lychgate](https://github.com/demir-sama/lychgate)_
```

Rows are added until the next row would pass 60,000 characters (GitHub's limit is 65,536); then one line says how many more links the diff holds. Backticks in a URL become `%60`, `|` and newlines in cells are escaped.

### Validation rules (R1.4 to R1.6, R3.4)
- `parseRepoSlug(s)` calls `parseRepoInput` and requires the exact `owner/repo` form with no `ref` or `path` and a repo name that did not lose a `.git` suffix. It reuses the name rule of `lib/github/repo.ts` instead of a second regex.
- Paths: `^[^\0-\x1f\\]+$`, split on `/`, no empty segment, no `.`, `..` or `.git` segment, no leading `/`, `/\.(md|markdown)$/i`.
- Replacements: `canonicalUrl(from) === from`, both `isHttpUrl`, `to !== from`, unique `from`.
- Token: `^[A-Za-z0-9_]{20,255}$`. This covers classic `ghp_`, fine-grained `github_pat_` and installation tokens, and cannot hold a character that splits an HTTP header.
- `.strict()` object: unknown keys are a 400.

### Writer (R2)
`openFixPullRequest(input, deps)` where `deps = { transport, now, random, signal? }`. The default `transport` is a thin `fetch` wrapper with `redirect: "manual"`; tests pass a fake one that records every call.

All calls go through `gh(method, path, body?)`:
1. `ghUrl(path)` builds `https://api.github.com${path}` from validated parts only, then asserts `new URL(u).origin === "https://api.github.com"`. Path segments of the repo and files are `encodeURIComponent`-ed one by one.
2. Headers: `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, a Lychgate `User-Agent`, `Content-Type: application/json` on writes.
3. `AbortSignal.any([overall 25 s, AbortSignal.timeout(10 s)])`.
4. A 3xx is an error, not followed (R2.3). Status mapping goes through one table so the route and the tests agree: 401 refused token, 403 and 429 with `x-ratelimit-remaining: 0` rate limit, 403 otherwise missing permission, 404 not found, 409 or 422 a conflict with GitHub's `message`, anything else 502.
5. Errors are `FixError(status, safeMessage(...))`. After the branch exists, `FixError` carries the branch name and the files already committed in its message (R2.12). Nothing is deleted.

**Why not `safeFetch`.** `safeFetch` (`lib/fetch/http.ts`) only does GET and HEAD and its DNS guard exists to stop user-chosen hosts from reaching private addresses. Fix it has no user-chosen host: the origin is a constant, asserted before every call, and redirects are never followed. The guard's threat does not exist here, so a second fetch path with the origin assertion is simpler than adding POST and PUT to the shared client. The assertion and `redirect: "manual"` are tested (R2.1, R2.3).

**Order of the writes.** Sequential `PUT`s on one branch each create a commit and move the ref. Parallel `PUT`s would race on the ref and return 409. With the 20 path cap, sequential writes fit the budget in normal cases. WHEN the 25 s budget runs out mid-way, the error names the branch and lists the committed files; the person can finish or delete the branch (R2.12).

**Branch name.** `lychgate/fix-${YYYYMMDD}-${base36x6}`, date from `now()` in UTC, six characters from `crypto.getRandomValues` mapped to base36 (rejection sampling is not needed; a tiny bias in a name suffix is harmless).

**Skipped paths.** A `contents` answer with `type: "file"`, `encoding: "base64"` and a `content` is decoded with `TextDecoder("utf-8", { fatal: true })`. Anything else (404, directory, symlink, submodule, over 1 MB, invalid UTF-8) goes to `skipped` with a reason and does not fail the request.

### Route (R3)
Mirrors `app/api/replacement/route.ts`: same `headers` object (`cache-control: no-store`, `x-content-type-options: nosniff`), same `clientIp` logic, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 30`. Differences:
- Body is read as bytes with a running count and refused above 64 KB before `JSON.parse` (`Content-Length` is only a fast path, since it can lie or be absent).
- Validation errors are built from `issue.path` and `issue.message` only. Zod messages for string patterns do not include the value; a test sends a bad token and asserts the response never contains it.
- The `catch` returns a static message for unexpected errors and calls no `console.*`. `FixError` messages are already redacted, and the route runs `safeMessage` on them once more (belt and braces, cheap).
- The rate limiter key is the IP only. The token is never part of any key.

### UI (R4)
`FixPanel` is a native `<dialog>` opened with `showModal()` (focus trap, Esc and inert background come from the platform). Fields: token (`type="password"`, `autoComplete="off"`, `spellCheck={false}`, `name` omitted so password managers and form restore do not store it), the explanation line, the counts, a submit button, a close button. The token string is `useState` inside the panel, set to `""` in a `finally` and on `close`.

`Scanner` records `scanKind` and `scanRepo` (slug) when a scan starts, next to the existing `setSource`. The panel receives `repo` from there, so editing the input after a scan cannot point the pull request at another repository. `fixPreview(docs, replacements)` returns `{ links, files, paths }` from the same `patchMarkdown` run the downloads use, so the counts in the panel equal what the downloads change.

Errors use `describeFixError(status, serverMessage)` which keeps the server's already-redacted text and adds a next step for 403 (fork and scan the fork), 401 (check the token scopes) and 429 (wait). Copy examples, in the haunted tone without hiding evidence:
- Success: "The dead rest; review the pull request."
- 422: "Nothing to fix: none of the chosen links appear in the files on the default branch."

### Security notes
- **Token path.** Browser memory, TLS to our route, TLS to `api.github.com`. It is never logged, cached, stored, keyed, echoed or put in a URL. The UI says it passes through the server (R4.3). Vercel does not log request bodies by default; the route still never prints them.
- **Redaction.** `redactToken` removes the exact token and token-shaped strings, so a token from a different request (for example one echoed in a GitHub error message) is also removed. Property test: for any token and any text containing it any number of times, the output contains no copy of the token and no `gh?_` or `github_pat_` shape.
- **Header injection.** The token pattern excludes whitespace and control characters.
- **No SSRF surface.** One constant origin, asserted per call; redirects not followed (this also prevents the `Authorization` header from reaching another host).
- **Least privilege.** The token is fine-grained and scoped by the person to one repository. The route requires `push`, refuses private and archived repositories, and writes only Markdown on a new branch. Default-branch writes, force-pushes and deletes are not in the code at all (R2.11); the fake-transport test fails on any other method or ref path.
- **Abuse.** The route works only with a token the caller already holds, so it cannot write anywhere the caller could not. The 5 per 10 minutes bucket and the same-origin check limit use as a relay. The content written is a link replacement the caller chose; `to` is validated as an http(s) URL and escaped per Markdown syntax by `patchMarkdown`.
- **Public repositories only.** Matches the scanner, which reads public repositories. The writer refuses private repositories even though the token could reach them. This is a conservative reading of `product.md` and is easy to relax later.
- **Test fixtures.** Fake tokens in tests are built at run time (`"ghp_" + "a".repeat(36)`), or carry the `test-token-not-real` marker, so `pnpm secret-scan` stays green.

### Tests

| File | Covers |
| --- | --- |
| `tests/fix-redact.test.ts` | R1.10, R1.11: fast-check over tokens and text; idempotent; never throws; token-shaped strings removed |
| `tests/fix-plan.test.ts` | R1.1 to R1.9: fast-check, only link spans change (bytes outside spans equal), unchanged files dropped, path and slug rules (`..`, leading `/`, backslash, NUL, extension), `from` canonical, unique, `why` derived, N in titles, body at most 60,000 characters |
| `tests/fix-github.test.ts` | R2: fake transport; happy path with the exact call sequence; no push permission; private; archived; nothing to fix (no write calls); skipped paths; branch collision retry; failure after branch creation names the branch; 3xx not followed; origin assertion; only GET, POST, PUT; token absent from every thrown error, every recorded log call and the return value |
| `tests/fix-route.test.ts` | R3: same-origin 403; 5 allowed then 429; 413 by header and by bytes; zod cases; status mapping; headers on every answer; token not in any response or `console` call |
| `tests/fix-ui.test.ts` | R4: pure helpers (`fixPreview`, `bodyBytes`, `describeFixError`, `isScanOfDefaultBranch`) and a static check that `FixPanel.tsx` and `Scanner.tsx` contain no `localStorage`, `sessionStorage`, `document.cookie`, `console.` or `location` use next to the token |

The repo has no DOM test environment. Focus movement, Esc, 390 px and 320 px layout, reduced motion and the screen-reader labels are checked in a browser pass (Playwright, like the earlier graveyard-ui QA) and recorded in `docs/kiro-runs/`.

## GitHub Action (R5, R6)

### Data flow

```
workflow step: uses: demir-sama/lychgate@<ref>  (or uses: ./ in this repo)
  action.yml ── node20 ──▶ action/dist/index.js   (esbuild bundle of action/src/index.ts)
                              │
   action/src/inputs.ts       │ parseInputs(env)        INPUT_PATHS, INPUT_MAX-FILES, ...
   action/src/files.ts        │ findMarkdown(root, globs, max)   glob match, skip dirs, rank, no symlinks
   action/src/git.ts          │ citeDatesFromGit(root, path, urls)   git log + git show, execFile, no shell
   lib/scan (engine)          │ runScan({ kind: "docs", docs, dates })    SSRF guard on every fetch
   action/src/summary.ts      │ renderSummary(...), failDecision(...)     pure
   action/src/run.ts          │ run(env, deps) -> { exitCode, summary, outputs }
                              ▼
   GITHUB_STEP_SUMMARY (append)   GITHUB_OUTPUT (health, dead)   stdout   exit 0 | 1 | 2
```

`index.ts` is a few lines: read `process.env`, call `run`, write the files, set `process.exitCode`. All logic is in `run.ts` and its helpers, so tests call `run` in process with a fake transport.

### Engine reuse
`ScanInput` gets one more variant, `{ kind: "docs"; docs: Doc[]; dates?: Record<path, Record<rawUrl, string>> }`, and `collect()` gets a matching `collectDocs` in `lib/scan/sources.ts` that extracts links per document (as `collectGitHub` does), sets `citeDate`, `citeSource: "git"` from `dates`, and applies the 300-link cap. `runScan` then does the rest, unchanged. `ScanInputSchema` (the `/api/scan` zod schema) does not accept `kind: "docs"`, because a web request must not be able to hand the engine file contents as if they came from a repo; a test asserts that.

### Files and globs
- Walk the workspace with `fs.opendir`, using `lstat` semantics: symlinks are neither followed nor read. Before reading, `realpath` must stay inside the workspace root (`readInsideCwd` from the MCP package is imported, so there is one sandbox).
- `matchGlob(pattern, path)` is a small pure matcher (`**`, `*`, `?`, `!` exclude, no braces, `/` separators, paths relative to the root, no `..`). A new dependency is not worth it for this.
- Ranking reuses `rankMarkdownPaths` with a new optional `limit` argument (default stays `MAX_MD_FILES`), so README first, then `docs/`, then shallow paths. The extension filter (`.md`, `.markdown`, plus `.mdx` from the shared helper) applies after the user's globs.

### Git cite dates
`git log --format=%H%x09%aI -n 100 -- <path>` gives commits newest first, in the `CommitInfo` shape. `contentAt(sha)` is `git show <sha>:<path>`. Both run with `execFile("git", [...], { cwd })`, and the path is passed after `--` or as a `<sha>:<path>` argument, so a file name cannot become an option or a shell command. The same `citeDatesFromHistory` binary search used for GitHub scans finds the commit that added each link, so the Action and the website agree. `git rev-parse --is-shallow-repository` true, or any git failure, adds one warning line and leaves `citeSource` as `none` (no drift or takeover checks for those links, as on the website).

### Summary and decision (pure)
- `failDecision(results, failOn) -> { fail, offending }`, with `failOn` a set of classes already validated by `parseInputs`.
- `renderSummary({ source, summary, results, warnings, failOn, capped, skippedRows }) -> string`. Layout: a heading ("Lychgate link check"), one line with the health score and the counts per class, then a table (`Location | Link | State | Cause | Snapshot`) of Tombstone, Ghost, Zombie, Drifted and any `fail-on` class, worst first. Locations are `file:line` of the first occurrence, `+N more` for the rest. URLs are in code spans, `|` and line breaks are escaped. Zombie rows say "a re-registered or parked domain is a security risk". Warnings follow. The renderer stops adding rows before 900 KB and says how many it left out. A clean run says so in one sentence.
- Outputs: `health` = `summary.health`; `dead` = Tombstone + Ghost + Zombie.

### Exit codes
0 no link in `fail-on`; 1 at least one; 2 invalid input or an unreadable workspace. GitHub treats any non-zero exit as a failed step, so a configuration mistake still shows red, but the number tells the two cases apart in logs.

### Security notes
- Read-only: no write path in the Action except the two GitHub-provided files and stdout. A test hashes the workspace before and after a run.
- No secrets, no token, no call to the Lychgate site: `permissions: contents: read` is enough. Pull requests from forks run with the same read-only footing.
- Runner SSRF: the engine's guard still blocks private and metadata addresses (a doc that links to `169.254.169.254` is Sealed, not fetched), which matters on a self-hosted runner inside a private network.
- Git runs with `execFile`; file names never reach a shell.
- Workflow command injection: the Action does not print file content or link text with `::` workflow-command syntax (no annotations in this version); everything user-derived goes to the summary file, which GitHub renders as Markdown, with `|`, line breaks and backticks escaped. HTML in a link title is not rendered because only the URL and the engine's own reason strings are used.
- Supply chain: the bundle is committed and a test compares it with a fresh build, so what runs is what was reviewed. No dependency that phones home is added; the bundle contains the same libraries as the MCP server.

### Bundle
`scripts/action-build.mjs` mirrors `scripts/mcp-build.mjs`: `platform: "node"`, `format: "esm"`, `target: "node20"`, `outfile: "action/dist/index.js"`, the same `createRequire` banner (the shebang is dropped, since the file is run by `node`). Node 20 treats a `.js` file as ESM only when the nearest `package.json` says `"type": "module"`, and the repo root's does not. The build therefore also writes `action/dist/package.json` containing `{ "type": "module" }`, and that file is committed with the bundle. The bundle test runs the bundle with `node`, which fails if this file is missing.

### Tests

| File | Covers |
| --- | --- |
| `tests/action-summary.test.ts` | R5.7, R5.8, R5.9, R5.11: `renderSummary` (rows, escaping, zombie wording, size cap, clean run), `failDecision` fast-check (fails iff a result class is in `failOn`; empty set never fails), `parseInputs` (defaults, bad `fail-on`, bad `max-files`, `living` refused) |
| `tests/action-files.test.ts` | R5.4: `matchGlob` properties (never matches a path with `..`; `!` excludes), `findMarkdown` on a temp tree (skips `node_modules`, ranks README first, cuts at `max-files`, ignores a symlink that points outside) |
| `tests/action-git.test.ts` | R5.5: a temp git repo with two commits; the link added in the second commit gets that commit's date; a shallow repo and a missing git binary give a warning, not a crash |
| `tests/action-core.test.ts` | R5.6, R5.9, R5.10: `run` in process with a fake transport: a Tombstone link and `fail-on` default gives exit 1; a Restless link gives 0; `fail-on` empty gives 0; outputs written; workspace hash unchanged |
| `tests/action.test.ts` | R5.1, R5.2: parses `action.yml`; runs `node action/dist/index.js` on a temp workspace with a Sealed link and no network, with `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` set to temp files; and compares the committed bundle with a fresh build |
| `tests/fix-it-docs.test.ts` | R6: the workflow file parses, uses `./`, has `permissions: contents: read`, `fetch-depth: 0`; README has both sections; the MCP README says read-only |

## Order of work and risks
1. `plan.ts` and `redact.ts` first: everything else depends on them and they are pure.
2. The writer second, then the route: the status table is defined once in the writer.
3. UI after the route, so the panel talks to a tested endpoint.
4. The Action does not depend on Fix it; it is last only by product order.

Risks to watch: the 64 KB cap can reject 300 long URL pairs (the UI says so and keeps the downloads); GitHub's contents API gives no content above 1 MB (skipped and reported); `execFile` of `git` is absent on a minimal runner image (warning, no crash); a stale bundle (caught by the bundle test).
