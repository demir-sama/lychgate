import { createTwoFilesPatch } from "diff";
import { extractMarkdownLinks, type LinkOccurrence } from "../extract/markdown";

/** Make a URL safe to drop into the occurrence's syntax without changing its meaning. */
export function escapeForKind(url: string, occ: Pick<LinkOccurrence, "kind" | "raw">): string {
  let u = url.replace(/\s/g, (c) => encodeURIComponent(c));
  if (occ.kind === "inline" || occ.kind === "image" || occ.kind === "definition") {
    // keep parentheses balanced inside a bare destination
    let depth = 0;
    let balanced = true;
    for (const c of u) {
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth < 0) balanced = false;
      }
    }
    if (!balanced || depth !== 0) u = u.replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  if (occ.kind === "autolink") u = u.replace(/</g, "%3C").replace(/>/g, "%3E");
  if (occ.kind === "html") u = u.replace(/"/g, "%22").replace(/'/g, "%27");
  return u;
}

export type PatchResult = { content: string; changed: Array<{ line: number; from: string; to: string }> };

/**
 * Replace the URLs whose canonical form is a key of `replacements`.
 * Only the exact source spans of those URLs change; every other byte is kept.
 */
export function patchMarkdown(src: string, replacements: Map<string, string>): PatchResult {
  if (replacements.size === 0) return { content: src, changed: [] };
  const occs = extractMarkdownLinks(src).filter((o) => replacements.has(o.canonical));
  let out = src;
  const changed: PatchResult["changed"] = [];
  for (let i = occs.length - 1; i >= 0; i--) {
    const o = occs[i];
    const to = escapeForKind(replacements.get(o.canonical)!, o);
    out = out.slice(0, o.start) + to + out.slice(o.end);
    changed.unshift({ line: o.line, from: o.raw, to });
  }
  return { content: out, changed };
}

export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, "", "", { context: 3 });
}
