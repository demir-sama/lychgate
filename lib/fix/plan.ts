import { z } from "zod";
import { isRepoName } from "../github/repo";
import { patchMarkdown } from "../patch/patch";
import { extractMarkdownLinks } from "../extract/markdown";
import { canonicalUrl, isArchiveUrl, isHttpUrl } from "../util/url";

/** Pure planning for "Fix it" pull requests (fix-it R1). No I/O, no token. */

export const MAX_REPLACEMENTS = 300;
export const MAX_PATHS = 20;
export const MAX_URL = 2048;
export const MAX_PATH = 300;
export const MAX_BODY_CHARS = 60_000;
const FOOTER = "_Opened with [Lychgate](https://github.com/demir-sama/lychgate)_";

export type Why = "Wayback snapshot" | "living replacement";
export type FixFile = { path: string; content: string };
export type FixReplacement = { from: string; to: string };
export type PlannedFile = { path: string; before: string; after: string; links: string[]; message: string };
export type PlannedLink = { from: string; to: string; why: Why; paths: string[] };
export type FixPlan = { files: PlannedFile[]; links: PlannedLink[]; title: string; body: string };

// ---- validation (R1.4 to R1.6) ----

const url = z
  .string()
  .max(MAX_URL, "must be at most 2048 characters")
  .refine(isHttpUrl, "must be an http(s) URL");

const Replacement = z.strictObject({
  from: url.refine((u) => canonicalUrl(u) === u, "must be in canonical form"),
  to: url,
});

export const ReplacementsSchema = z
  .array(Replacement)
  .min(1, "needs at least one replacement")
  .max(MAX_REPLACEMENTS, "at most 300 replacements")
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((r, i) => {
      if (r.to === r.from) ctx.addIssue({ code: "custom", path: [i, "to"], message: "must differ from from" });
      if (seen.has(r.from)) ctx.addIssue({ code: "custom", path: [i, "from"], message: "duplicate from" });
      seen.add(r.from);
    });
  });

// eslint-disable-next-line no-control-regex
const BAD_PATH_CHARS = /[\u0000-\u001f\u007f\\]/;

export function isValidPath(p: string): boolean {
  if (p.length < 1 || p.length > MAX_PATH) return false;
  if (BAD_PATH_CHARS.test(p) || p.startsWith("/")) return false;
  if (!/\.(md|markdown)$/i.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && seg.toLowerCase() !== ".git");
}

export const PathsSchema = z
  .array(z.string().refine(isValidPath, "is not an allowed Markdown path"))
  .min(1, "needs at least one path")
  .max(MAX_PATHS, "at most 20 paths")
  .refine((l) => new Set(l).size === l.length, "duplicate path");

/** Exactly `owner/repo`: no URL, ref, path or `.git` suffix. */
export function parseRepoSlug(s: string): { owner: string; repo: string } | null {
  if (typeof s !== "string") return null;
  const parts = s.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!isRepoName(owner) || !isRepoName(repo) || repo.endsWith(".git")) return null;
  return { owner, repo };
}

export const RepoSlugSchema = z.string().refine((s) => parseRepoSlug(s) !== null, "must be owner/repo");

export const TOKEN_PATTERN = /^[A-Za-z0-9_]{20,255}$/;
export const TokenSchema = z.string().regex(TOKEN_PATTERN, "is not a GitHub token");

export const FixInputSchema = z.strictObject({
  repo: RepoSlugSchema,
  token: TokenSchema,
  replacements: ReplacementsSchema,
  paths: PathsSchema,
});
export type FixInput = z.infer<typeof FixInputSchema>;

// ---- texts (R1.7 to R1.9) ----

export function whyOf(to: string): Why {
  return isArchiveUrl(to) ? "Wayback snapshot" : "living replacement";
}

const deadLinks = (n: number) => `${n} dead link${n === 1 ? "" : "s"}`;

export function prTitle(n: number): string {
  return `Lychgate: resurrect ${deadLinks(n)}`;
}

export function commitMessage(path: string, n: number): string {
  return `${prTitle(n)} in ${path}`;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** `lychgate/fix-<YYYYMMDD>-<6 base36 chars>`; `random` returns numbers in [0, 1). */
export function branchName(now: Date, random: () => number): string {
  const date = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`;
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += Math.min(35, Math.max(0, Math.floor(random() * 36))).toString(36);
  return `lychgate/fix-${date}-${suffix}`;
}

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const code = (s: string) => `\`${s.replace(/`/g, "%60").replace(/\|/g, "\\|").replace(/[\r\n]+/g, "%0A")}\``;

export function prBody(links: PlannedLink[]): string {
  const n = links.length;
  const head = [
    "## Resurrect dead links",
    "",
    `Lychgate found ${deadLinks(n)} in this repository and points each at where it can still be read.`,
    "",
    "| Was | Now | Why | Files |",
    "| --- | --- | --- | --- |",
  ].join("\n");
  const foot = `\n\n${FOOTER}\n`;
  const noteFor = (left: number) => `\n\n…and ${left} more ${left === 1 ? "link" : "links"}: the diff holds them all.`;
  const reserve = noteFor(n).length;
  let out = head;
  let shown = 0;
  for (const l of links) {
    const row = `\n| ${code(l.from)} | ${cell(l.to)} | ${l.why} | ${cell(l.paths.join(", "))} |`;
    if (out.length + row.length + reserve + foot.length > MAX_BODY_CHARS) break;
    out += row;
    shown++;
  }
  if (shown < n) out += noteFor(n - shown);
  return out + foot;
}

// ---- the plan (R1.1 to R1.3) ----

export function planFix(files: FixFile[], replacements: FixReplacement[]): FixPlan {
  const map = new Map<string, string>();
  for (const r of replacements) map.set(r.from, r.to);

  const planned: PlannedFile[] = [];
  const pathsOf = new Map<string, string[]>();
  for (const f of files) {
    const res = patchMarkdown(f.content, map);
    if (res.content === f.content) continue;
    // `changed` lines up with the occurrences `patchMarkdown` rewrote, in source order.
    const occs = extractMarkdownLinks(f.content).filter((o) => map.has(o.canonical));
    const froms = new Set<string>();
    occs.forEach((o, i) => {
      if (res.changed[i] && res.changed[i].from !== res.changed[i].to) froms.add(o.canonical);
    });
    const links = [...froms];
    planned.push({ path: f.path, before: f.content, after: res.content, links, message: commitMessage(f.path, links.length) });
    for (const from of links) pathsOf.set(from, [...(pathsOf.get(from) ?? []), f.path]);
  }

  const links: PlannedLink[] = [];
  for (const [from, to] of map) {
    const paths = pathsOf.get(from);
    if (paths) links.push({ from, to, why: whyOf(to), paths });
  }
  return { files: planned, links, title: prTitle(links.length), body: prBody(links) };
}
