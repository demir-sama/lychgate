import { parseHtml } from "../classify/html";
import { extractMarkdownLinks } from "../extract/markdown";
import { safeFetch, type SafeFetchOptions } from "../fetch/http";
import { citeDatesFromHistory, fetchRaw, GitHubClient, parseRepoInput, RateLimitError } from "../github/repo";
import { canonicalUrl } from "../util/url";
import { MAX_LINKS, type Doc, type DocDates, type Target } from "./types";

type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;
export type Collected = { source: string; targets: Target[]; found: number; capped: boolean; docs: Doc[]; warnings: string[] };

function validDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t) || t > Date.now() + 86400_000 || t < Date.parse("1991-01-01")) return undefined;
  return new Date(t).toISOString();
}

function finish(map: Map<string, Target>, source: string, docs: Doc[], warnings: string[]): Collected {
  const all = [...map.values()];
  const capped = all.length > MAX_LINKS;
  if (capped) warnings.push(`Found ${all.length} unique links; checking the first ${MAX_LINKS}.`);
  return { source, targets: all.slice(0, MAX_LINKS), found: all.length, capped, docs, warnings };
}

/** Pasted Markdown or a plain list of URLs. */
export function collectMarkdown(text: string, citeDate?: string): Collected {
  const cite = validDate(citeDate);
  const map = new Map<string, Target>();
  for (const o of extractMarkdownLinks(text)) {
    const t = map.get(o.canonical) ?? { url: o.canonical, occurrences: [], citeDate: cite, citeSource: cite ? "user" : "none" };
    t.occurrences.push({ doc: "pasted.md", line: o.line });
    map.set(o.canonical, t);
  }
  return finish(map, "Pasted Markdown", [{ path: "pasted.md", content: text }], []);
}

/** Files read from a local workspace (the Action): links per document, cite dates from local git. */
export function collectDocs(docs: Doc[], dates: DocDates = {}, source = "workspace"): Collected {
  const map = new Map<string, Target>();
  for (const doc of docs) {
    const byRaw = dates[doc.path] ?? {};
    for (const o of extractMarkdownLinks(doc.content)) {
      const d = byRaw[o.raw];
      const t = map.get(o.canonical) ?? { url: o.canonical, occurrences: [], citeSource: "none" as const };
      t.occurrences.push({ doc: doc.path, line: o.line });
      const when = d ? validDate(d.date) : undefined;
      if (when && (!t.citeDate || when < t.citeDate)) {
        t.citeDate = when;
        t.citeSource = "git";
        t.citeExact = d.exact;
      }
      map.set(o.canonical, t);
    }
  }
  return finish(map, source, docs, []);
}

/** Public GitHub repo: README + Markdown files, cite dates from git history. */
export async function collectGitHub(repoInput: string, deps: Deps = {}, onStatus?: (m: string) => void): Promise<Collected> {
  const ref = parseRepoInput(repoInput);
  if (!ref) throw new Error("That doesn't look like a public GitHub repo (try owner/repo or https://github.com/owner/repo).");
  const gh = new GitHubClient(deps);
  const warnings: string[] = [];
  onStatus?.(`Reading ${ref.owner}/${ref.repo} file tree…`);
  const { ref: gitRef, paths, truncated } = await gh.listMarkdown(ref);
  if (truncated) warnings.push("The repo tree was truncated by GitHub; some Markdown files may be missing.");
  if (!paths.length) throw new Error("No Markdown files found in that repo.");
  const docs: Doc[] = [];
  const map = new Map<string, Target>();
  let historyOk = true;
  let totalBytes = 0;
  for (const path of paths) {
    const content = await fetchRaw(ref, gitRef, path, deps).catch(() => null);
    if (content === null) continue;
    totalBytes += content.length;
    if (totalBytes > 3 * 1024 * 1024) {
      warnings.push("Stopped reading files after 3 MB of Markdown.");
      break;
    }
    docs.push({ path, content });
    const occs = extractMarkdownLinks(content);
    if (!occs.length) continue;
    let dates = new Map<string, { date: string; exact: boolean }>();
    if (historyOk && gh.canAfford(1)) {
      try {
        onStatus?.(`Reading git history of ${path}…`);
        const commits = await gh.fileCommits(ref, gitRef, path);
        const rawUrls = [...new Set(occs.map((o) => o.raw))];
        const byRaw = await citeDatesFromHistory(rawUrls, commits, (sha) => fetchRaw(ref, sha, path, deps));
        dates = new Map([...byRaw].map(([raw, v]) => [raw, v]));
      } catch (err) {
        historyOk = false;
        warnings.push(
          err instanceof RateLimitError
            ? `${err.message}. Cite dates are unknown for the rest of the files, so drift checks are skipped for them.`
            : `Couldn't read git history (${(err as Error).message}); drift checks skipped where dates are missing.`,
        );
      }
    } else if (historyOk) {
      historyOk = false;
      warnings.push("Saving the last GitHub API calls: cite dates unavailable for some files.");
    }
    for (const o of occs) {
      const d = dates.get(o.raw);
      const t = map.get(o.canonical) ?? { url: o.canonical, occurrences: [], citeSource: "none" as const };
      t.occurrences.push({ doc: path, line: o.line });
      if (d && (!t.citeDate || d.date < t.citeDate)) {
        t.citeDate = new Date(d.date).toISOString();
        t.citeSource = "git";
        t.citeExact = d.exact;
      }
      map.set(o.canonical, t);
    }
  }
  return finish(map, `github.com/${ref.owner}/${ref.repo}`, docs, warnings);
}

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  let m: RegExpExecArray | null;
  LOC.lastIndex = 0;
  while ((m = LOC.exec(xml))) locs.push(m[1].replace(/&amp;/g, "&"));
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

const MAX_SITEMAP_PAGES = 12;

async function getText(url: string, deps: Deps): Promise<{ body: string; finalUrl: string } | null> {
  const r = await safeFetch(url, { ...deps, readBody: true, maxBytes: 2 * 1024 * 1024 });
  if (r.status !== 200) return null;
  return { body: r.body ?? "", finalUrl: r.finalUrl };
}

/** A website page (its links), or a sitemap (links on up to 12 of its pages). */
export async function collectSite(input: string, opts: { sitemap?: boolean; citeDate?: string } = {}, deps: Deps = {}, onStatus?: (m: string) => void): Promise<Collected> {
  const start = canonicalUrl(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  if (!start) throw new Error("Enter a full website URL, like https://example.com/page");
  const cite = validDate(opts.citeDate);
  const warnings: string[] = [];
  let pages: string[] = [];
  const isXml = /\.xml(\?|$)/i.test(new URL(start).pathname);
  if (isXml || opts.sitemap) {
    const smUrl = isXml ? start : new URL("/sitemap.xml", start).href;
    onStatus?.(`Reading sitemap ${smUrl}…`);
    const sm = await getText(smUrl, deps).catch(() => null);
    if (sm) {
      let parsed = parseSitemap(sm.body);
      if (parsed.sitemaps.length) {
        const child = await getText(parsed.sitemaps[0], deps).catch(() => null);
        parsed = child ? parseSitemap(child.body) : { pages: [], sitemaps: [] };
      }
      pages = parsed.pages.filter((p) => canonicalUrl(p)).slice(0, MAX_SITEMAP_PAGES);
      if (parsed.pages.length > MAX_SITEMAP_PAGES) warnings.push(`Sitemap lists ${parsed.pages.length} pages; reading links from the first ${MAX_SITEMAP_PAGES}.`);
    } else warnings.push("No readable sitemap.xml; scanning just this page.");
  }
  if (!isXml && !pages.includes(start)) pages.unshift(start);
  if (!pages.length) throw new Error("Couldn't read any pages from that sitemap.");

  const map = new Map<string, Target>();
  for (const page of pages) {
    onStatus?.(`Reading links on ${page}…`);
    let got: { body: string; finalUrl: string } | null = null;
    try {
      got = await getText(page, deps);
    } catch (err) {
      warnings.push(`Couldn't read ${page}: ${(err as Error).message}`);
      continue;
    }
    if (!got) {
      warnings.push(`Couldn't read ${page} (non-200).`);
      continue;
    }
    const info = parseHtml(got.body, got.finalUrl);
    for (const href of info.links) {
      const c = canonicalUrl(href);
      if (!c) continue;
      const t = map.get(c) ?? { url: c, occurrences: [], citeDate: cite, citeSource: cite ? ("user" as const) : ("none" as const) };
      if (!t.occurrences.some((o) => o.doc === page)) t.occurrences.push({ doc: page, line: 0 });
      map.set(c, t);
    }
  }
  if (!map.size) throw new Error("No links found on that page.");
  return finish(map, new URL(start).hostname, [], warnings);
}
