import { LINK_CLASSES, type LinkClass } from "../classify/classify";
import type { SafeFetchOptions } from "../fetch/http";
import { analyzeTarget, ScanContext } from "./analyze";
import { collectDocs, collectGitHub, collectMarkdown, collectSite, type Collected } from "./sources";
import type { LinkResult, ScanEvent, ScanInput, ScanSummary } from "./types";

type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;

/** Health 0..100: living = 1, drifted = 0.5, restless/sealed excluded, dead/zombie = 0. */
export function healthScore(counts: Record<LinkClass, number>): number {
  const scored = counts.living + counts.drifted + counts.tombstone + counts.ghost + counts.zombie;
  if (!scored) return 100;
  return Math.round(((counts.living + counts.drifted * 0.5) / scored) * 100);
}

export function summarize(results: LinkResult[]): ScanSummary {
  const counts = Object.fromEntries(LINK_CLASSES.map((c) => [c, 0])) as Record<LinkClass, number>;
  for (const r of results) counts[r.cls]++;
  return { ...counts, total: results.length, health: healthScore(counts) };
}

export async function collect(input: ScanInput, deps: Deps, onStatus: (m: string) => void): Promise<Collected> {
  if (input.kind === "markdown") return collectMarkdown(input.text, input.citeDate);
  if (input.kind === "docs") return collectDocs(input.docs, input.dates, input.source);
  if (input.kind === "github") return collectGitHub(input.repo, deps, onStatus);
  return collectSite(input.url, { sitemap: input.sitemap, citeDate: input.citeDate }, deps, onStatus);
}

/**
 * Run a scan, yielding events as soon as each link is classified.
 * `budgetMs` bounds the whole scan; links not finished in time are reported as restless.
 */
export async function* runScan(input: ScanInput, opts: { deps?: Deps; budgetMs?: number; signal?: AbortSignal } = {}): AsyncGenerator<ScanEvent> {
  const t0 = Date.now();
  const deps = opts.deps ?? {};
  const queue: ScanEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: ScanEvent) => {
    queue.push(e);
    wake?.();
  };

  let collected: Collected | undefined;
  let collectError: Error | undefined;
  let collecting = true;
  collect(input, deps, (m) => push({ type: "status", message: m }))
    .then((c) => (collected = c), (e: Error) => (collectError = e))
    .finally(() => {
      collecting = false;
      wake?.();
    });
  while (collecting || queue.length) {
    if (!queue.length) await new Promise<void>((res) => (wake = res));
    wake = null;
    while (queue.length) yield queue.shift()!;
  }
  if (collectError || !collected) {
    yield { type: "error", message: collectError?.message ?? "Nothing to scan." };
    return;
  }
  yield { type: "meta", source: collected.source, total: collected.targets.length, found: collected.found, capped: collected.capped, docs: collected.docs, warnings: collected.warnings };

  const budget = AbortSignal.timeout(opts.budgetMs ?? 240_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, budget]) : budget;
  const ctx = new ScanContext(deps, signal);
  const results: LinkResult[] = [];
  let pending = collected.targets.length;

  for (const target of collected.targets) {
    analyzeTarget(target, ctx)
      .catch(
        (err): LinkResult => ({
          url: target.url,
          cls: "restless",
          confidence: 0.2,
          reasons: [signal.aborted ? "Scan time budget ran out before this link finished." : `Internal error: ${(err as Error).message}`],
          redirects: [],
          occurrences: target.occurrences,
          citeDate: target.citeDate,
          citeSource: target.citeSource,
          ms: 0,
        }),
      )
      .then((r) => {
        if (signal.aborted && r.cls === "restless" && r.reasons[0]?.startsWith("Could not confirm: aborted")) {
          r.reasons = ["Scan time budget ran out before this link finished."];
        }
        results.push(r);
        push({ type: "result", result: r });
        pending--;
        if (pending === 0) wake?.();
      });
  }

  while (pending > 0 || queue.length) {
    if (!queue.length) await new Promise<void>((res) => (wake = res));
    wake = null;
    while (queue.length) yield queue.shift()!;
  }
  yield { type: "done", summary: summarize(results), ms: Date.now() - t0 };
}
