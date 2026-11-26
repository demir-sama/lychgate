import type { LinkClass } from "../../lib/classify/classify";
import { ORDER, SPIRITS, fmtTs } from "../../components/graveyard/spirits";
import type { LinkResult, ScanSummary } from "../../lib/scan/types";

export const SUMMARY_MAX_BYTES = 900_000;
const ALWAYS_LISTED: LinkClass[] = ["tombstone", "ghost", "zombie", "drifted"];

/** R5.11: pure. Fails when, and only when, a result has a class in `failOn`. */
export function failDecision(results: LinkResult[], failOn: ReadonlySet<LinkClass>): { fail: boolean; offending: LinkResult[] } {
  const offending = results.filter((r) => failOn.has(r.cls));
  return { fail: offending.length > 0, offending };
}

/** Tombstone + Ghost + Zombie (R5.8). */
export const deadCount = (results: LinkResult[]): number => results.filter((r) => r.cls === "tombstone" || r.cls === "ghost" || r.cls === "zombie").length;

/** Text cell: no pipe, line break, bracket, angle bracket, backtick or backslash can change the table or the page. */
function cell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/`/g, "'");
}
/** URL in a code span so a dead address is not linked. */
const code = (url: string): string => `\`${url.replace(/`/g, "%60").replace(/\r?\n|\r/g, "%0A").replace(/\|/g, "%7C")}\``;

function location(r: LinkResult): string {
  const first = r.occurrences[0];
  if (!first) return "-";
  const more = r.occurrences.length > 1 ? ` +${r.occurrences.length - 1} more` : "";
  return `${code(`${first.doc}:${first.line}`)}${more}`;
}

export type SummaryArgs = {
  source: string;
  summary: ScanSummary;
  results: LinkResult[];
  warnings: string[];
  failOn: ReadonlySet<LinkClass>;
  capped?: boolean;
  found?: number;
  maxBytes?: number;
};

/** R5.7, R5.11: pure. GitHub renders the result as Markdown. */
export function renderSummary(a: SummaryArgs): string {
  const max = a.maxBytes ?? SUMMARY_MAX_BYTES;
  const counts = ORDER.filter((c) => a.summary[c] > 0)
    .map((c) => `${a.summary[c]} ${SPIRITS[c].label.toLowerCase()}`)
    .join(", ");
  const head = [
    "## Lychgate link check",
    "",
    `Checked ${a.summary.total} link${a.summary.total === 1 ? "" : "s"} in ${cell(a.source)}: health ${a.summary.health}/100${counts ? ` (${counts})` : ""}.`,
    "",
  ];
  if (a.capped) head.push(`Found ${a.found ?? "more than 300"} unique links; checked the first 300.`, "");

  const listed = new Set<LinkClass>([...ALWAYS_LISTED, ...a.failOn]);
  const rows = a.results
    .filter((r) => listed.has(r.cls))
    .sort((x, y) => ORDER.indexOf(x.cls) - ORDER.indexOf(y.cls) || y.confidence - x.confidence || x.url.localeCompare(y.url));

  const body: string[] = [];
  const tail: string[] = [];
  if (a.warnings.length) {
    tail.push("", "### Warnings", "", ...a.warnings.map((w) => `- ${cell(w)}`));
  }
  if (!rows.length) {
    head.push("Nothing is dead or drifted: no tombstones, ghosts, zombies or drifted links.");
  } else {
    const tableHead = ["| Location | Link | State | Cause | Snapshot |", "| --- | --- | --- | --- | --- |"];
    head.push("### Graves", "", ...tableHead);
    const reserve = Buffer.byteLength(tail.join("\n")) + 200;
    let used = Buffer.byteLength(head.join("\n")) + reserve;
    let left = 0;
    for (const r of rows) {
      const zombie = r.cls === "zombie" ? " A re-registered or parked domain is a security risk." : "";
      const snap = r.snapshot ? `${code(r.snapshot.url)} (${fmtTs(r.snapshot.timestamp)})` : "none found";
      const line = `| ${location(r)} | ${code(r.url)} | ${SPIRITS[r.cls].label} | ${cell(`${r.reasons.join(" ")}${zombie}`)} (confidence ${Math.round(r.confidence * 100)}%) | ${snap} |`;
      const size = Buffer.byteLength(line) + 1;
      if (used + size > max) left++;
      else {
        body.push(line);
        used += size;
      }
    }
    if (left) tail.unshift("", `${left} more row${left === 1 ? "" : "s"} left out to keep the summary under the size limit.`);
  }
  return [...head, ...body, ...tail, ""].join("\n");
}
