import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { findSnapshot, fetchSnapshotHtml, type ArchiveDeps } from "../../../lib/archive/wayback";
import { analyzeTarget, ScanContext } from "../../../lib/scan/analyze";
import { canonicalUrl } from "../../../lib/util/url";
import { fmtTs, THRESHOLDS } from "../../../lib/classify/classify";
import { cosineSimilarity, parseHtml } from "../../../lib/classify/html";
import { probeLink } from "../../../lib/fetch/http";
import { runScan } from "../../../lib/scan/engine";
import type { LinkResult, ScanEvent, ScanInput, ScanSummary } from "../../../lib/scan/types";
import { ORDER } from "../../../components/graveyard/spirits";
import { REPLACEMENT_BUDGET_MS, ReplacementInputSchema, suggestReplacement, type ReplacementReason } from "../../../lib/patch/replacement";

export type ToolDeps = ArchiveDeps;
export type ScanOptions = { budgetMs?: number; cwd?: string };
export const SCAN_BUDGET_MS = 120_000;
export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

const url = z
  .string()
  .trim()
  .min(1, "url is required")
  .max(2048)
  .refine((u) => canonicalUrl(u) !== null, "must be an http(s) URL");
const day = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD`);

export const ClassifyUrlInput = z.object({ url, citeDate: day("citeDate").optional() });
export const FindSnapshotInput = z.object({ url, before: day("before").optional() });
export const CheckDriftInput = z.object({ url, citeDate: day("citeDate") });
export const SuggestReplacementInput = ReplacementInputSchema;

/** Text block first (for the agent to quote), structured JSON second (R2.6). */
const ok = (text: string, data: unknown): ToolResult => ({
  content: [
    { type: "text", text },
    { type: "text", text: JSON.stringify(data) },
  ],
});

const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function invalid(err: z.ZodError): ToolResult {
  const detail = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  return fail(`Invalid input: ${detail}`);
}

export async function classifyUrlTool(args: unknown, deps: ToolDeps = {}): Promise<ToolResult> {
  const parsed = ClassifyUrlInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const target = canonicalUrl(parsed.data.url)!;
  const citeDate = parsed.data.citeDate;
  try {
    const ctx = new ScanContext(deps, AbortSignal.timeout(60_000));
    const r = await analyzeTarget({ url: target, occurrences: [], citeDate, citeSource: citeDate ? "user" : "none" }, ctx);
    const snap = r.snapshot ? ` Snapshot: ${r.snapshot.url} (${fmtTs(r.snapshot.timestamp)}${r.snapshot.beforeCite ? ", before the cite date" : ""}).` : "";
    const text = `${r.url} is ${r.cls} (confidence ${Math.round(r.confidence * 100)}%). ${r.reasons.join(" ")}${snap}`.trim();
    return ok(text, {
      url: r.url,
      cls: r.cls,
      confidence: r.confidence,
      reasons: r.reasons,
      status: r.status,
      finalUrl: r.finalUrl,
      snapshot: r.snapshot,
      drift: r.drift,
    });
  } catch (err) {
    return fail(`Could not classify ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function findSnapshotTool(args: unknown, deps: ToolDeps = {}): Promise<ToolResult> {
  const parsed = FindSnapshotInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const target = canonicalUrl(parsed.data.url)!;
  const before = parsed.data.before;
  try {
    const { snapshot, source, error } = await findSnapshot(target, before ? new Date(`${before}T23:59:59Z`) : null, deps);
    if (!snapshot) {
      const why = error ? ` The archive lookup failed: ${error}` : "";
      return ok(`No snapshot of ${target} exists${before ? ` on or before ${before}` : ""}.${why}`, { url: target, before, found: false, source, error });
    }
    return ok(`Closest snapshot${before ? ` on or before ${before}` : ""}: ${snapshot.url} (captured ${fmtTs(snapshot.timestamp)}).`, {
      url: target,
      before,
      found: true,
      source,
      snapshot,
    });
  } catch (err) {
    return fail(`Could not look up ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Same comparison the scanner makes: snapshot text at the cite date vs. live text, cosine similarity. */
export async function checkDriftTool(args: unknown, deps: ToolDeps = {}): Promise<ToolResult> {
  const parsed = CheckDriftInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const target = canonicalUrl(parsed.data.url)!;
  const { citeDate } = parsed.data;
  const base = { url: target, citeDate, threshold: THRESHOLDS.drift };
  const cannot = (why: string, extra: Record<string, unknown> = {}) => ok(`Cannot measure drift for ${target}: ${why}`, { ...base, comparable: false, reason: why, ...extra });
  try {
    const signal = AbortSignal.timeout(60_000);
    const live = await probeLink(target, { ...deps, wantBody: true, signal });
    if (live.error) return cannot(`the live page could not be fetched (${live.error.message}).`, { error: live.error.kind });
    if (!live.ok || !live.body) return cannot(`the live page answered ${live.status ?? "nothing"} with no readable content.`, { status: live.status });
    const liveText = parseHtml(live.body).text;
    const found = await findSnapshot(target, new Date(`${citeDate}T23:59:59Z`), deps);
    if (!found.snapshot) return cannot(`no snapshot exists on or before ${citeDate}.${found.error ? ` The archive lookup failed: ${found.error}` : ""}`, { status: live.status });
    const html = await fetchSnapshotHtml(found.snapshot, deps).catch(() => null);
    const then = html ? parseHtml(html).text : "";
    if (then.length <= 200 || liveText.length === 0) return cannot(`the snapshot from ${fmtTs(found.snapshot.timestamp)} has too little text to compare.`, { status: live.status, snapshot: found.snapshot });
    const similarity = cosineSimilarity(then, liveText);
    const drifted = similarity < THRESHOLDS.drift;
    const pct = Math.round(similarity * 100);
    const text = drifted
      ? `${target} has drifted: the live page is ${pct}% similar to the snapshot from ${fmtTs(found.snapshot.timestamp)} (below the ${Math.round(THRESHOLDS.drift * 100)}% threshold). It may no longer say what was cited.`
      : `${target} has not drifted: the live page is ${pct}% similar to the snapshot from ${fmtTs(found.snapshot.timestamp)} (threshold ${Math.round(THRESHOLDS.drift * 100)}%).`;
    return ok(text, { ...base, comparable: true, similarity, drifted, status: live.status, snapshot: found.snapshot });
  } catch (err) {
    return fail(`Could not check drift for ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const ScanLinksInput = z
  .object({
    path: z.string().trim().min(1).max(1024).optional(),
    markdown: z.string().min(1).max(500_000).optional(),
    url: z.string().trim().min(4).max(2048).optional(),
    repo: z.string().trim().min(3).max(300).optional(),
    citeDate: day("citeDate").optional(),
  })
  .refine((v) => [v.path, v.markdown, v.url, v.repo].filter((x) => x !== undefined).length === 1, "give exactly one of path, markdown, url or repo");

/** Resolve `p` (symlinks and `..` included) and refuse anything outside `cwd` (R3.2). */
export async function readInsideCwd(p: string, cwd: string): Promise<{ rel: string; text: string }> {
  const root = await realpath(cwd);
  const outside = () => new Error(`${p} is outside the working directory, so it was not read.`);
  const inside = (r: string) => r !== "" && r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
  const wanted = isAbsolute(p) ? p : resolve(root, p);
  if (!inside(relative(root, wanted))) throw outside();
  const real = await realpath(wanted);
  const rel = relative(root, real);
  if (!inside(rel)) throw outside();
  return { rel: rel.split(sep).join("/"), text: await readFile(real, "utf8") };
}

export async function scanLinksTool(args: unknown, deps: ToolDeps = {}, opts: ScanOptions = {}): Promise<ToolResult> {
  const parsed = ScanLinksInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const { path, markdown, url: pageUrl, repo, citeDate } = parsed.data;
  const budgetMs = opts.budgetMs ?? SCAN_BUDGET_MS;
  let input: ScanInput;
  let docName: string | undefined;
  try {
    if (path !== undefined) {
      const f = await readInsideCwd(path, opts.cwd ?? process.cwd());
      docName = f.rel;
      input = { kind: "markdown", text: f.text, citeDate };
    } else if (markdown !== undefined) input = { kind: "markdown", text: markdown, citeDate };
    else if (pageUrl !== undefined) input = { kind: "site", url: pageUrl, citeDate };
    else input = { kind: "github", repo: repo! };
  } catch (err) {
    return fail(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budgetMs);
  const results: LinkResult[] = [];
  let meta: Extract<ScanEvent, { type: "meta" }> | undefined;
  let summary: ScanSummary | undefined;
  let error: string | undefined;
  try {
    for await (const ev of runScan(input, { deps, budgetMs, signal: ctl.signal })) {
      if (ev.type === "meta") meta = ev;
      else if (ev.type === "result") results.push(ev.result);
      else if (ev.type === "done") summary = ev.summary;
      else if (ev.type === "error") error = ev.message;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  if (error || !meta || !summary) return fail(`Scan failed: ${error ?? "no result"}`);

  if (docName) for (const r of results) for (const o of r.occurrences) o.doc = docName;
  const timedOut = results.some((r) => r.reasons.some((x) => x.startsWith("Scan time budget ran out")));
  const worst = results
    .filter((r) => r.cls !== "living")
    .sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || b.confidence - a.confidence);
  const counts = ORDER.filter((c) => summary![c] > 0).map((c) => `${summary![c]} ${c}`).join(", ");
  const notes = [
    meta.capped ? `Found ${meta.found} unique links; checked the first 300.` : "",
    timedOut ? `The time budget (${Math.round(budgetMs / 1000)} s) ran out; unfinished links are marked restless.` : "",
    ...meta.warnings.filter((w) => !w.startsWith("Found ")),
  ].filter(Boolean);
  const lines = worst.slice(0, 20).map((r) => {
    const at = r.occurrences[0] ? ` (${r.occurrences[0].doc}:${r.occurrences[0].line})` : "";
    const snap = r.snapshot ? ` snapshot ${r.snapshot.url}` : "";
    return `- ${r.cls}: ${r.url}${at}${snap}`;
  });
  const more = worst.length > 20 ? [`...and ${worst.length - 20} more in the JSON block.`] : [];
  const text = [
    `Scanned ${summary.total} links from ${meta.source}: health ${summary.health}/100${counts ? ` (${counts})` : ""}.`,
    ...notes,
    ...(worst.length ? lines.concat(more) : ["No dead, drifted or unconfirmed links."]),
  ].join("\n");
  return ok(text, { source: meta.source, summary, found: meta.found, capped: meta.capped, timedOut, warnings: meta.warnings, results: worst });
}

const REASON_TEXT: Record<ReplacementReason, string> = {
  "github-rename": "the GitHub repository was renamed",
  redirect: "the old address redirects there",
  sitemap: "it is the closest match in the site's sitemap",
};

/** Read-only: proposes one live URL for a moved page; nothing is changed (R4.13). */
export async function suggestReplacementTool(args: unknown, deps: ToolDeps = {}): Promise<ToolResult> {
  const parsed = SuggestReplacementInput.safeParse(args);
  if (!parsed.success) return invalid(parsed.error);
  const target = canonicalUrl(parsed.data.url)!;
  try {
    const budget = AbortSignal.timeout(REPLACEMENT_BUDGET_MS);
    const replacement = await suggestReplacement(target, { deps, signal: budget });
    const timedOut = replacement === null && budget.aborted;
    if (!replacement) {
      const why = timedOut ? ` The ${REPLACEMENT_BUDGET_MS / 1000} s budget ran out first.` : "";
      return ok(`No replacement found for ${target}.${why} It is still worth looking for the Wayback snapshot.`, { url: target, found: false, replacement: null, timedOut });
    }
    const text = `${target} may now live at ${replacement.url} (${REASON_TEXT[replacement.reason]}; confidence ${Math.round(replacement.confidence * 100)}%). It answered as a living page just now. This is a suggestion; nothing was changed.`;
    return ok(text, { url: target, found: true, replacement, timedOut: false });
  } catch (err) {
    return fail(`Could not look for a replacement for ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
