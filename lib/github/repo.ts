import { safeFetch, type SafeFetchOptions } from "../fetch/http";
import { TtlCache } from "../util/cache";

type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;

export type RepoRef = { owner: string; repo: string; ref?: string; path?: string };

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** Accepts `owner/repo`, `https://github.com/owner/repo`, `.../tree/<ref>/<path>`, `.../blob/<ref>/<file>`. */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (/^(www\.)?github\.com\//i.test(s)) s = `https://${s}`;
  else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/.*)?$/.test(s)) s = `https://github.com/${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, kind, ref, ...rest] = parts;
  if (!NAME.test(owner) || !NAME.test(repo) || repo === "." || repo === "..") return null;
  if ((kind === "tree" || kind === "blob") && ref) return { owner, repo, ref, path: rest.length ? rest.join("/") : undefined };
  return { owner, repo };
}

export const MAX_MD_FILES = 20;
const MD_EXT = /\.(md|markdown|mdx)$/i;
const SKIP_DIRS = /(^|\/)(node_modules|vendor|\.git|dist|build|third_party|\.github\/ISSUE_TEMPLATE)\//i;

/** Rank Markdown paths: README first, then docs/, then shallow paths. */
export function rankMarkdownPaths(paths: string[], within?: string): string[] {
  const filtered = paths.filter((p) => MD_EXT.test(p) && !SKIP_DIRS.test(p) && (!within || p === within || p.startsWith(within.replace(/\/?$/, "/"))));
  const score = (p: string) => {
    const base = p.split("/").pop()!.toLowerCase();
    let s = p.split("/").length * 10;
    if (base.startsWith("readme")) s -= 100;
    if (/^docs?\//i.test(p)) s -= 20;
    if (/changelog|history|license|code_of_conduct/i.test(base)) s += 50;
    return s;
  };
  return [...filtered].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, MAX_MD_FILES);
}

export type CommitInfo = { sha: string; date: string };

/** GitHub REST client: unauthenticated by default, tracks rate limit headers. */
export class GitHubClient {
  remaining = Number.POSITIVE_INFINITY;
  resetAt = 0;
  calls = 0;
  constructor(
    private deps: Deps = {},
    private token = process.env.GITHUB_TOKEN,
    /** keep this many API calls in reserve; below it we skip optional calls */
    readonly reserve = 3,
  ) {}

  canAfford(n = 1) {
    return this.remaining - n >= this.reserve || (this.resetAt && Date.now() > this.resetAt);
  }

  private async api<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { "x-github-api-version": "2022-11-28" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await safeFetch(`https://api.github.com${path}`, {
      ...this.deps,
      readBody: true,
      timeoutMs: 10_000,
      accept: "application/vnd.github+json",
      headers,
      maxBytes: 4 * 1024 * 1024,
    });
    this.calls++;
    const rem = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (rem !== null) this.remaining = Number(rem);
    if (reset !== null) this.resetAt = Number(reset) * 1000;
    if (res.status === 403 || res.status === 429) {
      if (this.remaining === 0 || res.status === 429) throw new RateLimitError(this.resetAt);
    }
    if (res.status === 404) throw new NotFoundError(path);
    if (res.status !== 200) throw new Error(`GitHub API HTTP ${res.status} for ${path}`);
    return JSON.parse(res.body ?? "null") as T;
  }

  /**
   * Canonical `full_name` of a repository. GitHub answers a renamed repo with a 301 to
   * `/repositories/{id}`, which the guarded fetch follows, so this is how a rename shows up.
   */
  async repo(owner: string, repo: string): Promise<{ fullName: string }> {
    const info = await this.api<{ full_name?: unknown }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    if (typeof info?.full_name !== "string" || !info.full_name.includes("/")) throw new Error(`GitHub API gave no full_name for ${owner}/${repo}`);
    return { fullName: info.full_name };
  }

  async listMarkdown(r: RepoRef): Promise<{ ref: string; paths: string[]; truncated: boolean }> {
    const ref = r.ref ?? "HEAD";
    const tree = await this.api<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>(
      `/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    const paths = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    return { ref, paths: rankMarkdownPaths(paths, r.path), truncated: tree.truncated };
  }

  async fileCommits(r: RepoRef, ref: string, path: string): Promise<CommitInfo[]> {
    const q = new URLSearchParams({ path, per_page: "100" });
    if (ref !== "HEAD") q.set("sha", ref);
    const list = await this.api<Array<{ sha: string; commit: { committer?: { date?: string }; author?: { date?: string } } }>>(
      `/repos/${r.owner}/${r.repo}/commits?${q}`,
    );
    return list.map((c) => ({ sha: c.sha, date: c.commit.author?.date ?? c.commit.committer?.date ?? "" })).filter((c) => c.date);
  }
}

export class RateLimitError extends Error {
  constructor(readonly resetAt: number) {
    super(`GitHub API rate limit reached${resetAt ? `; resets ${new Date(resetAt).toISOString()}` : ""}`);
    this.name = "RateLimitError";
  }
}
export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found on GitHub (${path.split("?")[0]}). Is the repo public?`);
    this.name = "NotFoundError";
  }
}

const rawCache = new TtlCache<Promise<string | null>>(3600_000, 500);

/** raw.githubusercontent.com is not counted against the REST API quota. */
export function fetchRaw(r: RepoRef, ref: string, path: string, deps: Deps = {}): Promise<string | null> {
  const encPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${encodeURIComponent(ref)}/${encPath}`;
  return rawCache.wrap(url, async () => {
    const res = await safeFetch(url, { ...deps, readBody: true, timeoutMs: 10_000, accept: "text/plain", maxBytes: 1024 * 1024 });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`raw HTTP ${res.status} for ${path}`);
    return res.body ?? "";
  });
}

/**
 * Git-history cite date for each URL ("when was this link added?"), unauthenticated:
 * commits are newest-first; a URL present at HEAD is binary-searched back through the
 * file's history (contents read from raw.githubusercontent.com at each commit SHA).
 * Assumes a link, once added, stays until HEAD (true for the common case; if it was
 * removed and re-added we report the most recent addition, which is still a valid
 * "cited by" date). If the URL is present in the oldest listed commit, that commit's
 * date is an upper bound (`exact: false`).
 */
export async function citeDatesFromHistory(
  urls: string[],
  commits: CommitInfo[],
  contentAt: (sha: string) => Promise<string | null>,
): Promise<Map<string, { date: string; exact: boolean; sha: string }>> {
  const out = new Map<string, { date: string; exact: boolean; sha: string }>();
  if (!commits.length) return out;
  const memo = new Map<string, Promise<string | null>>();
  const at = (i: number) => {
    const sha = commits[i].sha;
    if (!memo.has(sha)) memo.set(sha, contentAt(sha).catch(() => null));
    return memo.get(sha)!;
  };
  for (const url of urls) {
    // invariant: present at lo; absent at hi (hi may be commits.length = "before history")
    let lo = 0;
    let hi = commits.length;
    const head = await at(0);
    if (head !== null && !head.includes(url)) continue; // not at HEAD of history (e.g. uncommitted) — skip
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const c = await at(mid);
      if (c !== null && c.includes(url)) lo = mid;
      else hi = mid;
    }
    out.set(url, { date: commits[lo].date, exact: hi < commits.length || commits.length < 100, sha: commits[lo].sha });
  }
  return out;
}
