import { extractMarkdownLinks } from "../extract/markdown";
import { patchMarkdown } from "../patch/patch";
import type { Doc } from "../scan/types";
import { isHttpUrl } from "../util/url";
import { redactToken } from "./redact";

/**
 * Pure helpers for the "Open a pull request" panel (fix-it R4). No I/O, no token kept.
 * Client-safe: this file must not import `./plan` (it pulls in the server-side GitHub client);
 * `tests/fix-ui.test.ts` checks that these rules agree with the server's.
 */

export const MAX_FIX_BODY = 64 * 1024;
const MAX_PATHS = 20;
const MAX_REPLACEMENTS = 300;
const MAX_URL = 2048;
const MAX_PATH = 300;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export type FixReplacementBody = { from: string; to: string };
export type FixPreview = {
  /** Replacements the server needs: only links rewritten in a kept file. */
  replacements: FixReplacementBody[];
  /** Files that change, in scan order, at most 20. */
  paths: string[];
  files: number;
  links: number;
  /** Changed files left out by the 20-file cap. */
  omittedFiles: number;
};

function okPath(p: string): boolean {
  if (p.length < 1 || p.length > MAX_PATH || !/\.(md|markdown)$/i.test(p)) return false;
  if (/[\x00-\x1f\x7f\\]/.test(p) || p.startsWith("/")) return false;
  return p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && s !== ".git");
}

function okTo(u: string): boolean {
  return u.length <= MAX_URL && isHttpUrl(u);
}

/** What the pull request would change, from the same `patchMarkdown` run the downloads use. */
export function fixPreview(docs: Doc[], replacements: Map<string, string>): FixPreview {
  const map = new Map<string, string>();
  for (const [from, to] of replacements) if (from.length <= MAX_URL && from !== to && okTo(to)) map.set(from, to);
  const changed: Array<{ path: string; froms: string[] }> = [];
  if (map.size) {
    const seen = new Set<string>();
    for (const d of docs) {
      if (!okPath(d.path) || seen.has(d.path)) continue;
      seen.add(d.path);
      const res = patchMarkdown(d.content, map);
      if (res.content === d.content) continue;
      const occs = extractMarkdownLinks(d.content).filter((o) => map.has(o.canonical));
      const froms = new Set<string>();
      occs.forEach((o, i) => {
        if (res.changed[i] && res.changed[i].from !== res.changed[i].to) froms.add(o.canonical);
      });
      if (froms.size) changed.push({ path: d.path, froms: [...froms] });
    }
  }
  const kept = changed.slice(0, MAX_PATHS);
  const used = new Set(kept.flatMap((c) => c.froms));
  const out: FixReplacementBody[] = [];
  for (const [from, to] of map) if (used.has(from) && out.length < MAX_REPLACEMENTS) out.push({ from, to });
  const sent = new Set(out.map((r) => r.from));
  // Keep only files whose links are all sent, so the counts match what the server will rewrite.
  const paths = kept.filter((c) => c.froms.some((f) => sent.has(f))).map((c) => c.path);
  return { replacements: out, paths, files: paths.length, links: out.length, omittedFiles: changed.length - paths.length };
}

/** The request body exactly as `POST /api/fix` takes it. */
export function buildFixBody(repo: string, token: string, p: FixPreview) {
  return { repo, token, replacements: p.replacements, paths: p.paths };
}

/** UTF-8 size of a body once serialised, the way the route counts it. */
export function bodyBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/**
 * The repository a finished GitHub scan can open a pull request on. `defaultBranch` is false when
 * the input named a branch or path, because the pull request targets the default branch (R4.1).
 */
export function scanFixTarget(kind: "github" | "site" | "markdown", input: string): { slug: string; defaultBranch: boolean } | null {
  if (kind !== "github" || typeof input !== "string") return null;
  let s = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
    s = u.pathname;
  } else s = s.replace(/^(www\.)?github\.com\//i, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  for (const n of [owner, repo]) if (!NAME.test(n) || n === "." || n === "..") return null;
  if (repo.endsWith(".git")) return null;
  return { slug: `${owner}/${repo}`, defaultBranch: parts.length === 2 };
}

export function isScanOfDefaultBranch(input: string): boolean {
  return scanFixTarget("github", input)?.defaultBranch === true;
}

/** The server's (already redacted) words plus a next step. Never shows a token. */
export function describeFixError(status: number, serverMessage: string): string {
  const base = redactToken(String(serverMessage ?? "").trim()).slice(0, 300) || `GitHub or Lychgate answered ${status}.`;
  const hint =
    status === 401
      ? " Check that the token is fine-grained, covers this repository, and has Contents and Pull requests read and write."
      : status === 403 && !/private|archived|fork/i.test(base)
        ? " If you cannot push to this repository, fork it and scan the fork."
        : status === 429
          ? " Wait a few minutes before trying again."
          : status === 413
            ? " Use the downloads instead."
            : status === 504
              ? " A lychgate/ branch may already exist on the repository; check it before trying again."
              : "";
  return base + hint;
}
