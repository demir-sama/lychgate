import type { Doc, LinkResult } from "../scan/types";
import { patchMarkdown } from "./patch";

/** Wayback "if_" mode renders the capture without the toolbar, which suits a framed preview. */
export function framedSnapshotUrl(snapshotUrl: string): string {
  return snapshotUrl.replace(/\/web\/(\d{4,14})(?:[a-z]{2}_)?\//, "/web/$1if_/");
}

/** Lines of the source docs that cite `r.url`, before and after resurrection (max 4). */
export function patchPreview(docs: Doc[], r: Pick<LinkResult, "url" | "occurrences">, replacement: string): Array<{ where: string; before: string; after: string }> {
  const out: Array<{ where: string; before: string; after: string }> = [];
  for (const o of r.occurrences.slice(0, 4)) {
    const doc = docs.find((d) => d.path === o.doc);
    if (!doc || !o.line) continue;
    const before = doc.content.split("\n")[o.line - 1] ?? "";
    const after = patchMarkdown(before, new Map([[r.url, replacement]])).content;
    if (before !== after) out.push({ where: `${o.doc}:${o.line}`, before, after });
  }
  return out;
}
