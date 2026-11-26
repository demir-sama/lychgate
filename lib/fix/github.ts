import { planFix, parseRepoSlug, branchName, type FixReplacement } from "./plan";
import { safeMessage } from "./redact";

/**
 * Opens a "Fix it" pull request with the caller's own token (fix-it R2).
 * Talks only to https://api.github.com, never follows redirects, uses only
 * GET, POST and PUT, never writes to the default branch and never deletes.
 */

const ORIGIN = "https://api.github.com";
const CALL_MS = 10_000;
const TOTAL_MS = 25_000;
const SHA_RE = /^[0-9a-f]{40,64}$/i;

export type FixTransport = (url: string, init: RequestInit) => Promise<Response>;
export type FixDeps = {
  transport?: FixTransport;
  now?: () => Date;
  random?: () => number;
  signal?: AbortSignal;
};
export type FixRequest = { repo: string; token: string; replacements: FixReplacement[]; paths: string[] };
export type FixResult = {
  url: string;
  number: number;
  branch: string;
  files: string[];
  links: number;
  skipped: Array<{ path: string; reason: string }>;
};

export class FixError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FixError";
    this.status = status;
  }
}

/** The one place a URL is built. Anything that would leave api.github.com is refused. */
export function ghUrl(path: string): string {
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("Refused: not an API path.");
  const url = `${ORIGIN}${path}`;
  if (new URL(url).origin !== ORIGIN) throw new Error("Refused: not api.github.com.");
  return url;
}

const defaultTransport: FixTransport = (url, init) => fetch(url, { ...init, redirect: "manual" });

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");

function defaultRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

const isAbort = (e: unknown) => {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
};

type Reply = { status: number; headers: Headers; data: any };

export async function openFixPullRequest(input: FixRequest, deps: FixDeps = {}): Promise<FixResult> {
  const { token } = input;
  const transport = deps.transport ?? defaultTransport;
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? defaultRandom;
  const overall = AbortSignal.any([AbortSignal.timeout(TOTAL_MS), ...(deps.signal ? [deps.signal] : [])]);

  const fail = (status: number, msg: string) => new FixError(status, safeMessage(msg, token));
  const slug = parseRepoSlug(input.repo);
  if (!slug) throw fail(400, "The repository must be written owner/repo.");
  const base = `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`;

  let branch: string | null = null;
  const committed: string[] = [];

  const after = () =>
    branch ? ` The branch ${branch} exists${committed.length ? ` with ${committed.join(", ")} already committed` : " with nothing committed yet"}; review or delete it on GitHub.` : "";

  const gh = async (method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Reply> => {
    let res: Response;
    try {
      res = await transport(ghUrl(path), {
        method,
        redirect: "manual",
        signal: AbortSignal.any([overall, AbortSignal.timeout(CALL_MS)]),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Lychgate (+https://github.com/demir-sama/lychgate)",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if (e instanceof FixError) throw e;
      if (isAbort(e)) throw fail(504, `GitHub took too long to answer.${after()}`);
      throw fail(502, `Could not reach GitHub: ${safeMessage(e, token)}.${after()}`);
    }
    if (res.status >= 300 && res.status < 400) {
      throw fail(404, `The repository moved. Scan its new name and try again.${after()}`);
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, headers: res.headers, data };
  };

  const ghMessage = (r: Reply) => {
    const m = r.data && typeof r.data === "object" && typeof r.data.message === "string" ? r.data.message : "";
    return m.length > 200 ? `${m.slice(0, 199)}…` : m;
  };

  /** One status table: GitHub's answer to a FixError. */
  const reject = (r: Reply, what: string): FixError => {
    const note = ghMessage(r);
    const tail = note ? ` (${note})` : "";
    const rateLimited = r.status === 429 || (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0");
    if (rateLimited) {
      const reset = Number(r.headers.get("x-ratelimit-reset"));
      const when = Number.isFinite(reset) && reset > 0 ? ` It resets at ${new Date(reset * 1000).toISOString()}.` : "";
      return fail(429, `GitHub rate limit spent.${when}${after()}`);
    }
    if (r.status === 401) return fail(401, `GitHub refused the token. Check that it is valid and has Contents and Pull requests read and write.${after()}`);
    if (r.status === 403) return fail(403, `The token may not ${what}${tail}. Fork the repository and scan the fork instead.${after()}`);
    if (r.status === 404) return fail(404, `Repository or file not found, or the token cannot see it.${after()}`);
    return fail(502, `GitHub could not ${what}${tail}.${after()}`);
  };

  // 1. the repository
  const repo = await gh("GET", base);
  if (repo.status !== 200) throw reject(repo, "read the repository");
  const info = repo.data ?? {};
  if (info.private === true) throw fail(403, "Lychgate opens pull requests on public repositories only. This one is private.");
  if (info.archived === true) throw fail(403, "This repository is archived, so it is read-only.");
  if (info.permissions?.push !== true) {
    throw fail(403, "The token has no push permission here. Fork the repository, scan the fork and open the pull request there.");
  }
  const defaultBranch = typeof info.default_branch === "string" ? info.default_branch : "";
  if (!defaultBranch) throw fail(502, "GitHub did not say which branch is the default.");

  // 2. the head of the default branch
  const ref = await gh("GET", `${base}/git/ref/heads/${enc(defaultBranch)}`);
  if (ref.status !== 200) throw reject(ref, "read the default branch");
  const head = ref.data?.object?.sha;
  if (typeof head !== "string" || !SHA_RE.test(head)) throw fail(502, "GitHub answered with an unreadable branch head.");

  // 3. the files, at that one commit
  const files: Array<{ path: string; content: string }> = [];
  const blobs = new Map<string, string>();
  const skipped: FixResult["skipped"] = [];
  for (const path of input.paths) {
    const r = await gh("GET", `${base}/contents/${enc(path)}?ref=${encodeURIComponent(head)}`);
    if (r.status === 404) {
      skipped.push({ path, reason: "not found on the default branch" });
      continue;
    }
    if (r.status !== 200) throw reject(r, "read a file");
    const d = r.data;
    if (!d || Array.isArray(d) || d.type !== "file") {
      skipped.push({ path, reason: "not a regular file" });
      continue;
    }
    if (d.encoding !== "base64" || typeof d.content !== "string" || d.content === "" || typeof d.sha !== "string") {
      skipped.push({ path, reason: "too large for the contents API (over 1 MB)" });
      continue;
    }
    try {
      const bytes = Buffer.from(d.content.replace(/\s+/g, ""), "base64");
      // ignoreBOM keeps a leading byte-order mark in the text, so the patch keeps it too.
      files.push({ path, content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) });
      blobs.set(path, d.sha);
    } catch {
      skipped.push({ path, reason: "not valid UTF-8" });
    }
  }

  // 4. plan (pure); nothing to do means no write at all
  const plan = planFix(files, input.replacements);
  if (plan.files.length === 0) {
    throw fail(422, "Nothing to fix: none of the chosen links appear in the files on the default branch.");
  }

  // 5. the branch
  let created = false;
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    const name = branchName(now(), random);
    const r = await gh("POST", `${base}/git/refs`, { ref: `refs/heads/${name}`, sha: head });
    if (r.status === 201 || r.status === 200) {
      branch = name;
      created = true;
    } else if (r.status === 422 && /already exists/i.test(ghMessage(r)) && attempt === 0) {
      continue;
    } else {
      throw reject(r, "create a branch");
    }
  }
  if (!created || !branch) throw fail(502, "GitHub could not create a free branch name. Try again.");

  // 6. one commit per changed file, in order, never in parallel
  for (const f of plan.files) {
    const r = await gh("PUT", `${base}/contents/${enc(f.path)}`, {
      message: f.message,
      content: Buffer.from(f.after, "utf8").toString("base64"),
      sha: blobs.get(f.path),
      branch,
    });
    if (r.status !== 200 && r.status !== 201) throw reject(r, `write ${f.path}`);
    committed.push(f.path);
  }

  // 7. the pull request
  const pr = await gh("POST", `${base}/pulls`, {
    title: plan.title,
    body: plan.body,
    head: branch,
    base: defaultBranch,
  });
  if (pr.status !== 201 && pr.status !== 200) throw reject(pr, "open the pull request");
  const url = pr.data?.html_url;
  const number = pr.data?.number;
  if (typeof url !== "string" || typeof number !== "number") throw fail(502, "GitHub opened the pull request but did not say where.");

  return { url, number, branch, files: committed, links: plan.links.length, skipped };
}
