import path from "node:path";
import type { LinkClass } from "../../lib/classify/classify";
import { extractMarkdownLinks } from "../../lib/extract/markdown";
import type { SafeFetchOptions } from "../../lib/fetch/http";
import { runScan } from "../../lib/scan/engine";
import type { DocDates, LinkResult, ScanEvent, ScanSummary } from "../../lib/scan/types";
import { findMarkdown } from "./files";
import { citeDatesFromGit } from "./git";
import { parseInputs } from "./inputs";
import { deadCount, failDecision, renderSummary } from "./summary";

export type RunDeps = { deps?: Pick<SafeFetchOptions, "transport" | "resolver">; budgetMs?: number };
export type RunResult = {
  exitCode: 0 | 1 | 2;
  summary: string;
  outputs: { health: number; dead: number };
  stdout: string[];
};

const EMPTY: ScanSummary = { living: 0, tombstone: 0, ghost: 0, drifted: 0, zombie: 0, restless: 0, sealed: 0, total: 0, health: 100 };
const stop = (message: string): RunResult => ({ exitCode: 2, summary: `## Lychgate link check\n\n${message}\n`, outputs: { health: 0, dead: 0 }, stdout: [`Lychgate: ${message}`] });

/** All the logic of the Action. Reads the workspace, never writes; the caller writes the three outputs. */
export async function run(env: Record<string, string | undefined>, d: RunDeps = {}): Promise<RunResult> {
  const parsed = parseInputs(env);
  if (!parsed.ok) return stop(parsed.message);
  const inputs = parsed.value;
  const root = path.resolve(env.GITHUB_WORKSPACE || process.cwd());

  let found: Awaited<ReturnType<typeof findMarkdown>>;
  try {
    found = await findMarkdown(root, inputs.paths, inputs.maxFiles);
  } catch {
    return stop("The workspace could not be read. Did `actions/checkout` run before this step?");
  }
  const warnings = [...found.warnings];
  if (!found.files.length) {
    const summary = renderSummary({ source: "workspace", summary: EMPTY, results: [], warnings, failOn: inputs.failOn }).replace(
      "Nothing is dead or drifted",
      "No Markdown files matched `paths`, so nothing was checked. Nothing is dead or drifted",
    );
    return { exitCode: 0, summary, outputs: { health: 100, dead: 0 }, stdout: ["Lychgate: no Markdown files matched."] };
  }

  const dates: DocDates = {};
  if (inputs.citeDates === "git") {
    let gitWarned = false;
    for (const f of found.files) {
      const raws = [...new Set(extractMarkdownLinks(f.content).map((o) => o.raw))];
      if (!raws.length) continue;
      const g = await citeDatesFromGit(root, f.path, raws);
      if (g.warning && !gitWarned) {
        warnings.push(g.warning);
        gitWarned = true;
      }
      dates[f.path] = Object.fromEntries([...g.dates].map(([raw, v]) => [raw, { date: v.date, exact: v.exact }]));
    }
  }

  const results: LinkResult[] = [];
  let meta: Extract<ScanEvent, { type: "meta" }> | undefined;
  let summary: ScanSummary | undefined;
  let error: string | undefined;
  for await (const ev of runScan({ kind: "docs", docs: found.files, dates, source: "workspace" }, { deps: d.deps, budgetMs: d.budgetMs ?? 240_000 })) {
    if (ev.type === "meta") meta = ev;
    else if (ev.type === "result") results.push(ev.result);
    else if (ev.type === "done") summary = ev.summary;
    else if (ev.type === "error") error = ev.message;
  }
  if (error || !meta || !summary) return stop(`The scan failed: ${error ?? "no result"}`);

  const timedOut = results.some((r) => r.reasons.some((x) => x.startsWith("Scan time budget ran out")));
  if (timedOut) warnings.push("The time budget ran out; unfinished links are marked restless.");
  warnings.push(...meta.warnings.filter((w) => !w.startsWith("Found ")));

  const decision = failDecision(results, inputs.failOn);
  const md = renderSummary({ source: "workspace", summary, results, warnings, failOn: inputs.failOn, capped: meta.capped, found: meta.found });
  const dead = deadCount(results);
  const counts = (Object.keys(summary) as Array<keyof ScanSummary>).filter((k) => k !== "total" && k !== "health" && summary![k] > 0).map((k) => `${summary![k]} ${k as LinkClass}`);
  return {
    exitCode: decision.fail ? 1 : 0,
    summary: md,
    outputs: { health: summary.health, dead },
    stdout: [`Lychgate: ${summary.total} links, health ${summary.health}/100${counts.length ? ` (${counts.join(", ")})` : ""}.`, decision.fail ? `Lychgate: ${decision.offending.length} link(s) in a fail-on class. See the job summary.` : "Lychgate: no link in a fail-on class."],
  };
}
