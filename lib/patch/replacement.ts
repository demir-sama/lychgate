import { Parser } from "htmlparser2";
import { getDomain } from "tldts";
import { z } from "zod";
import { fetchSnapshotHtml, findSnapshot } from "../archive/wayback";
import type { LinkClass } from "../classify/classify";
import { parseHtml } from "../classify/html";
import { assertPublicUrl, defaultResolver } from "../fetch/guard";
import { probeLink, safeFetch, type SafeFetchOptions } from "../fetch/http";
import { GitHubClient } from "../github/repo";
import { analyzeTarget, ScanContext } from "../scan/analyze";
import { canonicalUrl } from "../util/url";

/**
 * Suggested live replacement for a link that moved (resurrection-engine R4).
 * Sources, in order: GitHub rename, same-domain redirect, same-site sitemap. A suggestion is only
 * ever a URL the scanner's own probe classed as Living. No search API, no secret, every request
 * goes through the SSRF guard.
 */

export const REPLACEMENT_BUDGET_MS = 15_000;
export const MAX_SITEMAP_URLS = 5000;
export const MAX_SITEMAP_BYTES = 512 * 1024;
export const MAX_VERIFIED_CANDIDATES = 3;
export const MIN_SLUG_SCORE = 0.4;

export type ReplacementReason = "github-rename" | "redirect" | "sitemap";
export type Replacement = { url: string; reason: ReplacementReason; confidence: number };
export type VerifyResult = { cls: LinkClass; title?: string };

export const ReplacementInputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "url is required")
    .max(2048)
    .refine((u) => canonicalUrl(u) !== null, "must be an http(s) URL"),
});

type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;

export type ReplacementOptions = {
  deps?: Deps;
  signal?: AbortSignal;
  /** GitHub API client; defaults to an unauthenticated-by-default `GitHubClient` over `deps`. */
  github?: { canAfford(n?: number): boolean | number; repo(owner: string, repo: string): Promise<{ fullName: string }> };
  /** Class (and title) of a candidate. Defaults to the scanner's `analyzeTarget`. */
  verify?: (url: string) => Promise<VerifyResult>;
  /** Title of the old page, from its newest Wayback copy. Defaults to the Wayback lookup. */
  refTitle?: (url: string) => Promise<string | null>;
};

// ---------------------------------------------------------------- ranking (pure)

const registrable = (host: string) => getDomain(host, { allowPrivateDomains: true });

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);

function pathSegments(url: string): string[] {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return [];
  }
  const segs = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (segs.length) segs[segs.length - 1] = segs[segs.length - 1].replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return segs;
}

/** Lower-cased words of the path, extension dropped. */
export function slugTokens(url: string): string[] {
  return pathSegments(url).flatMap(words);
}

function lastSlugTokens(url: string): string[] {
  const segs = pathSegments(url);
  while (segs.length > 1 && segs[segs.length - 1].toLowerCase() === "index") segs.pop();
  return segs.length ? words(segs[segs.length - 1]) : [];
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let both = 0;
  for (const t of sa) if (sb.has(t)) both++;
  return both / (sa.size + sb.size - both);
}

/** 0..1: how much `candidate`'s path looks like `target`'s (last segment counts most). */
export function slugScore(target: string, candidate: string): number {
  return Math.min(1, 0.7 * jaccard(lastSlugTokens(target), lastSlugTokens(candidate)) + 0.3 * jaccard(slugTokens(target), slugTokens(candidate)));
}

const byScoreThenUrl = <T extends { url: string }>(score: (x: T) => number) => (a: T, b: T) => score(b) - score(a) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

/**
 * Same-site candidates for `target`, best first. Drops the target itself, site roots, other
 * registrable domains, non-http(s) URLs and anything under MIN_SLUG_SCORE. Total order
 * (score desc, URL asc), so the input order cannot change the result.
 */
export function rankCandidates(target: string, urls: string[]): Array<{ url: string; score: number }> {
  const self = canonicalUrl(target);
  let domain: string | null = null;
  try {
    domain = registrable(new URL(target).hostname);
  } catch {
    return [];
  }
  if (!domain) return [];
  const seen = new Map<string, { url: string; score: number }>();
  for (const raw of urls) {
    const url = canonicalUrl(raw);
    if (!url || url === self || seen.has(url)) continue;
    const u = new URL(url);
    if ((u.pathname === "/" || u.pathname === "") && !u.search) continue;
    if (registrable(u.hostname) !== domain) continue;
    const score = slugScore(target, url);
    if (score >= MIN_SLUG_SCORE) seen.set(url, { url, score });
  }
  return [...seen.values()].sort(byScoreThenUrl((x) => x.score));
}

/** `<loc>` values of a sitemap document, at most `maxUrls`. Never throws. */
export function parseSitemap(xml: string, maxUrls = MAX_SITEMAP_URLS): { kind: "urlset" | "index"; locs: string[] } {
  let kind: "urlset" | "index" = "urlset";
  const locs: string[] = [];
  let first = true;
  let inLoc = false;
  let text = "";
  const parser = new Parser(
    {
      onopentag(name) {
        const n = name.toLowerCase();
        if (first) {
          first = false;
          if (n === "sitemapindex") kind = "index";
        }
        if (n === "loc") {
          inLoc = true;
          text = "";
        }
      },
      ontext(data) {
        if (inLoc) text += data;
      },
      onclosetag(name) {
        if (name.toLowerCase() !== "loc" || !inLoc) return;
        inLoc = false;
        const v = text.trim();
        if (v && locs.length < maxUrls) locs.push(v);
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  try {
    parser.write(xml);
    parser.end();
  } catch {
    /* keep whatever was read */
  }
  return { kind, locs };
}

const GH_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const validName = (s: string) => GH_NAME.test(s) && !/^\.+$/.test(s);

function githubParts(url: string): { owner: string; repo: string; rest: string; search: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const m = /^\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m || !validName(m[1]) || !validName(m[2])) return null;
  return { owner: m[1], repo: m[2], rest: m[3] ?? "", search: u.search };
}

/** Same GitHub URL on the renamed repo (rest of the path and query kept), or null if the name did not change. */
export function mapGithubUrl(url: string, fullName: string): string | null {
  const parts = githubParts(url);
  const m = /^([^/]+)\/([^/]+)$/.exec(fullName);
  if (!parts || !m || !validName(m[1]) || !validName(m[2])) return null;
  if (`${parts.owner}/${parts.repo}`.toLowerCase() === fullName.toLowerCase()) return null;
  return `https://github.com/${fullName}${parts.rest}${parts.search}`;
}

// ---------------------------------------------------------------- engine

const round2 = (n: number) => Math.round(n * 100) / 100;

async function fetchSitemapDoc(url: string, ctx: ScanContext) {
  try {
    const res = await ctx.limiter.run(
      url,
      () => safeFetch(url, { ...ctx.deps, signal: ctx.signal, readBody: true, maxBytes: MAX_SITEMAP_BYTES, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" }),
      ctx.signal,
    );
    if (res.status !== 200 || !res.body) return null;
    return parseSitemap(res.body);
  } catch {
    return null;
  }
}

/** One sitemap fetch, plus at most one child when it is an index (same host, best slug match, never deeper). */
async function sitemapUrls(target: string, ctx: ScanContext): Promise<string[]> {
  const root = `${new URL(target).origin}/sitemap.xml`;
  const doc = await fetchSitemapDoc(root, ctx);
  if (!doc) return [];
  if (doc.kind === "urlset") return doc.locs;
  const host = new URL(target).hostname.toLowerCase();
  const children = doc.locs
    .map((l) => canonicalUrl(l))
    .filter((l): l is string => {
      if (!l || l === root) return false;
      const u = new URL(l);
      return u.hostname.toLowerCase() === host && !/\.gz$/i.test(u.pathname);
    })
    .map((url) => ({ url, score: jaccard(slugTokens(url), slugTokens(target)) }))
    // Array.sort is stable: equal scores keep the index's document order (sites list their primary sitemap first).
    .sort((a, b) => b.score - a.score);
  if (!children.length) return [];
  const child = await fetchSitemapDoc(children[0].url, ctx);
  return child && child.kind === "urlset" ? child.locs : [];
}

async function waybackTitle(target: string, ctx: ScanContext): Promise<string | null> {
  const found = await ctx.wayback.run(() => findSnapshot(target, null, ctx.deps));
  if (!found.snapshot) return null;
  const snap = found.snapshot;
  const html = await ctx.wayback.run(() => fetchSnapshotHtml(snap, ctx.deps));
  return html ? parseHtml(html).title || null : null;
}

/**
 * One live replacement for `input`, or null. Never throws: a failing source counts as "no
 * candidate" (R4.10). Only a URL that `verify` classed as living is ever returned (R4.7).
 */
export async function suggestReplacement(input: string, opts: ReplacementOptions = {}): Promise<Replacement | null> {
  try {
    const target = canonicalUrl(input);
    if (!target || opts.signal?.aborted) return null;
    const deps = opts.deps ?? {};
    // Sealed or unresolvable targets get no further request at all.
    await assertPublicUrl(target, deps.resolver ?? defaultResolver);

    const ctx = new ScanContext(deps, opts.signal);
    const verify =
      opts.verify ??
      (async (url: string): Promise<VerifyResult> => {
        const r = await analyzeTarget({ url, occurrences: [], citeSource: "none" }, ctx);
        return { cls: r.cls, title: r.title };
      });
    const isLiving = async (url: string) => (await verify(url).catch(() => ({ cls: "restless" as LinkClass }))).cls === "living";
    const url = new URL(target);
    const onGithub = /^(www\.)?github\.com$/i.test(url.hostname);

    // R4.1, R4.2: GitHub renames.
    const gh = onGithub ? githubParts(target) : null;
    if (gh) {
      const client = opts.github ?? new GitHubClient(deps);
      if (client.canAfford()) {
        try {
          const { fullName } = await client.repo(gh.owner, gh.repo);
          const mapped = mapGithubUrl(target, fullName);
          if (mapped && (await isLiving(mapped))) return { url: mapped, reason: "github-rename", confidence: 0.95 };
        } catch {
          /* rate limit, missing repo, network: no candidate from this source */
        }
      }
    }

    // R4.3: same-domain redirect.
    try {
      const probe = await ctx.limiter.run(target, () => probeLink(target, { ...deps, signal: opts.signal }), opts.signal);
      const final = probe.ok && probe.finalUrl ? canonicalUrl(probe.finalUrl) : null;
      if (final && final !== target) {
        const f = new URL(final);
        const rootPage = (f.pathname === "/" || f.pathname === "") && !f.search;
        const dom = registrable(f.hostname);
        if (!rootPage && dom && dom === registrable(url.hostname) && (await isLiving(final))) return { url: final, reason: "redirect", confidence: 0.9 };
      }
    } catch {
      /* no candidate */
    }

    // R4.4, R4.5, R4.6: same-site sitemap.
    if (onGithub) return null;
    const ranked = rankCandidates(target, await sitemapUrls(target, ctx)).slice(0, MAX_VERIFIED_CANDIDATES);
    const checked = await Promise.all(
      ranked.map(async (c) => ({ ...c, v: await verify(c.url).catch((): VerifyResult => ({ cls: "restless" })) })),
    );
    const alive = checked.filter((c) => c.v.cls === "living");
    if (!alive.length) return null;
    let oldTitle: string | null = null;
    if (alive.length > 1) oldTitle = await (opts.refTitle ?? ((u: string) => waybackTitle(u, ctx)))(target).catch(() => null);
    const final = alive
      .map((c) => ({ url: c.url, score: oldTitle && c.v.title ? 0.7 * c.score + 0.3 * jaccard(words(oldTitle), words(c.v.title)) : c.score }))
      .sort(byScoreThenUrl((x) => x.score))[0];
    return { url: final.url, reason: "sitemap", confidence: round2(Math.min(0.85, 0.3 + 0.55 * final.score)) };
  } catch {
    return null;
  }
}
