import { findSnapshot, fetchSnapshotHtml, type Snapshot } from "../archive/wayback";
import { classify, NEEDS_RESURRECTION, type Evidence } from "../classify/classify";
import { cosineSimilarity, lengthRatio, parseHtml } from "../classify/html";
import { detectParked, looksLikeNotFound, redirectedToRoot } from "../classify/signals";
import { lookupRdap } from "../domain/rdap";
import { HostLimiter, Semaphore } from "../fetch/limiter";
import { probeLink, type SafeFetchOptions } from "../fetch/http";
import type { LinkResult, Target } from "./types";

type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;

/** Shared per-scan state: limiters, budgets and per-directory soft-404 probe cache. */
export class ScanContext {
  readonly limiter = new HostLimiter(8, 24);
  readonly wayback = new Semaphore(4);
  readonly rdap = new Semaphore(3);
  readonly probes = new Map<string, Promise<{ status: number; title: string; text: string } | null>>();
  driftBudget = 40;
  probeBudget = 60;
  constructor(
    readonly deps: Deps = {},
    readonly signal?: AbortSignal,
  ) {}
}

function probeDirKey(url: URL) {
  const dir = url.pathname.replace(/[^/]*$/, "");
  return `${url.origin}${dir}`;
}

async function softProbe(ctx: ScanContext, target: URL) {
  const key = probeDirKey(target);
  let p = ctx.probes.get(key);
  if (!p) {
    if (ctx.probeBudget <= 0) return null;
    ctx.probeBudget--;
    const rand = Math.random().toString(36).slice(2, 10);
    const probeUrl = new URL(`lychgate-${rand}-not-a-real-page`, key).href;
    p = ctx.limiter.run(probeUrl, async () => {
      const r = await probeLink(probeUrl, { ...ctx.deps, wantBody: true, signal: ctx.signal });
      if (r.error || r.status === undefined) return null;
      const info = r.body ? parseHtml(r.body) : { title: "", text: "" };
      return { status: r.status, title: info.title, text: info.text };
    });
    ctx.probes.set(key, p);
  }
  return p;
}

const isDeep = (u: URL) => u.pathname.replace(/\/+$/, "").length > 0 || u.search.length > 1;

export async function analyzeTarget(target: Target, ctx: ScanContext): Promise<LinkResult> {
  const t0 = Date.now();
  const url = new URL(target.url);
  const citeDate = target.citeDate ? new Date(target.citeDate) : null;
  const probe = await ctx.limiter.run(target.url, () => probeLink(target.url, { ...ctx.deps, wantBody: true, signal: ctx.signal }));
  const ev: Evidence = {
    status: probe.status,
    error: probe.error,
    finalUrl: probe.finalUrl,
    redirectCount: probe.redirects.length,
    citeDate: target.citeDate,
  };
  let liveText = "";
  if (probe.body) {
    const info = parseHtml(probe.body);
    ev.title = info.title || undefined;
    liveText = info.text;
    if (probe.ok) ev.notFoundText = looksLikeNotFound(info.title, info.text);
  }
  if (probe.ok || probe.body) {
    const parked = detectParked({ html: probe.body, finalUrl: probe.finalUrl, redirectUrls: probe.redirects.map((r) => r.to) });
    if (parked) ev.parked = parked;
  }
  if (probe.ok) ev.redirectedToRoot = redirectedToRoot(target.url, probe.finalUrl);

  // Soft-404 probe: does a made-up sibling URL look the same?
  if (probe.ok && probe.body && !ev.parked && !ev.notFoundText && !ev.redirectedToRoot && isDeep(url) && !ctx.signal?.aborted) {
    const sp = await softProbe(ctx, url).catch(() => null);
    if (sp) {
      const liveLen = liveText.length;
      ev.softProbe = {
        status: sp.status,
        similarity: cosineSimilarity(liveText, sp.text),
        lengthRatio: lengthRatio(liveLen, sp.text.length),
        titleMatch: !!ev.title && ev.title === sp.title,
      };
    }
  }

  // RDAP: takeover check when we know the cite date, or when DNS says the domain is gone.
  const dnsDead = probe.error?.kind === "dns" && probe.error.code !== "EAI_AGAIN";
  if ((citeDate || dnsDead) && !ctx.signal?.aborted && probe.error?.kind !== "ssrf") {
    const r = await ctx.rdap.run(() => lookupRdap(url.hostname, ctx.deps));
    ev.rdap = { status: r.status, registered: r.registered };
  }

  // Drift: compare live text with the snapshot from (just before) the cite date.
  let snapshot: Snapshot | null = null;
  let beforeCite = !!citeDate;
  const ghostish = ev.notFoundText || ev.redirectedToRoot || ev.parked;
  // Home pages are expected to change, so drift is only judged for deep links.
  if (probe.ok && probe.body && citeDate && isDeep(url) && !ghostish && ctx.driftBudget > 0 && !ctx.signal?.aborted) {
    ctx.driftBudget--;
    const found = await ctx.wayback.run(() => findSnapshot(target.url, citeDate, ctx.deps));
    snapshot = found.snapshot;
    if (snapshot) {
      const html = await ctx.wayback.run(() => fetchSnapshotHtml(snapshot!, ctx.deps)).catch(() => null);
      if (html) {
        const then = parseHtml(html).text;
        if (then.length > 200 && liveText.length > 0) ev.drift = { similarity: cosineSimilarity(then, liveText), snapshotTimestamp: snapshot.timestamp };
      }
    }
  }

  const verdict = classify(ev);

  // Resurrection candidate for anything dead / drifted / hijacked.
  if (NEEDS_RESURRECTION.has(verdict.cls) && !snapshot && !ctx.signal?.aborted) {
    const found = await ctx.wayback.run(() => findSnapshot(target.url, citeDate, ctx.deps));
    snapshot = found.snapshot;
    if (!snapshot && citeDate) {
      const latest = await ctx.wayback.run(() => findSnapshot(target.url, null, ctx.deps));
      snapshot = latest.snapshot;
      beforeCite = false;
    }
  }

  return {
    url: target.url,
    cls: verdict.cls,
    confidence: verdict.confidence,
    reasons: verdict.reasons,
    status: probe.status,
    finalUrl: probe.finalUrl,
    redirects: probe.redirects,
    title: ev.title,
    citeDate: target.citeDate,
    citeSource: target.citeSource,
    occurrences: target.occurrences,
    snapshot: snapshot ? { timestamp: snapshot.timestamp, url: snapshot.url, beforeCite: beforeCite && !!citeDate } : undefined,
    drift: ev.drift?.similarity,
    rdapRegistered: ev.rdap?.registered,
    ms: Date.now() - t0,
  };
}
