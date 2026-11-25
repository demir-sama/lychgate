import type { LinkResult } from "../scan/types";
import type { Replacement, ReplacementReason } from "./replacement";

/** What the patch does with one link. */
export type Choice = "snapshot" | "replacement" | "keep";
export type Found = Pick<Replacement, "url" | "reason" | "confidence">;

const RESURRECTABLE = new Set(["tombstone", "ghost", "zombie", "drifted"]);
const DEFAULT_RESURRECT = new Set(["tombstone", "ghost", "zombie"]);

/** Snapshot for dead links that have one; keep for the rest. Never the replacement (R5.5). */
export function defaultChoice(r: Pick<LinkResult, "cls" | "snapshot">): Choice {
  return r.snapshot && DEFAULT_RESURRECT.has(r.cls) ? "snapshot" : "keep";
}

/** The URL a choice points at, or null when it has no target (R5.8). */
export function targetFor(r: Pick<LinkResult, "url" | "cls" | "snapshot">, choice: Choice | undefined, found: Found | null | undefined): string | null {
  if (!RESURRECTABLE.has(r.cls)) return null;
  const to = choice === "snapshot" ? r.snapshot?.url : choice === "replacement" ? found?.url : undefined;
  return to && to !== r.url ? to : null;
}

/** Map for `patchMarkdown`: link URL to the URL the patch writes in its place. */
export function replacementMap(results: LinkResult[], choices: Record<string, Choice | undefined>, found: Record<string, Found | null | undefined>): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of results) {
    const to = targetFor(r, choices[r.url], found[r.url]);
    if (to) m.set(r.url, to);
  }
  return m;
}

/** Links the patch points at a snapshot, and links it points at a living replacement (for the PR text). */
export function choiceSummary(results: LinkResult[], choices: Record<string, Choice | undefined>, found: Record<string, Found | null | undefined>) {
  const snapshot: LinkResult[] = [];
  const replacement: Array<{ r: LinkResult; found: Found }> = [];
  for (const r of results) {
    if (!targetFor(r, choices[r.url], found[r.url])) continue;
    if (choices[r.url] === "snapshot") snapshot.push(r);
    else replacement.push({ r, found: found[r.url]! });
  }
  return { snapshot, replacement };
}

export function reasonText(reason: ReplacementReason): string {
  return reason === "github-rename" ? "GitHub rename" : reason === "redirect" ? "redirect on the same site" : "same-site sitemap";
}

/** Where one on-demand replacement lookup stands (R5.1 to R5.3). */
export type Lookup = { state: "idle" } | { state: "loading" } | { state: "done"; replacement: Found | null; timedOut: boolean } | { state: "error"; message: string };
