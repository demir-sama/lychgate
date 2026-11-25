import { z } from "zod";
import type { LinkResult, ScanSummary } from "../scan/types";

/** Classes a shared report can hold (mirrors LinkClass). */
const CLASSES = ["living", "tombstone", "ghost", "drifted", "zombie", "restless", "sealed"] as const;

export const REPORT_MAX_RESULTS = 300;
export const REPORT_TTL_DAYS = 30;

const Url = z.string().max(2048);

const ResultSchema = z.object({
  url: Url,
  cls: z.enum(CLASSES),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().max(400)).max(8),
  status: z.number().int().optional(),
  finalUrl: Url.optional(),
  title: z.string().max(200).optional(),
  citeDate: z.string().max(40).optional(),
  citeSource: z.enum(["git", "user", "none"]).optional(),
  occurrences: z.array(z.object({ doc: z.string().max(300), line: z.number().int() })).max(20),
  snapshot: z.object({ timestamp: z.string().max(20), url: Url, beforeCite: z.boolean() }).optional(),
  drift: z.number().min(0).max(1).optional(),
  rdapRegistered: z.string().max(40).optional(),
});

export type SharedResult = z.infer<typeof ResultSchema>;

export const ReportInputSchema = z.object({
  source: z.string().min(1).max(300),
  results: z.array(ResultSchema).min(1).max(REPORT_MAX_RESULTS),
});

export type ReportInput = z.infer<typeof ReportInputSchema>;

export type StoredReport = {
  id: string;
  source: string;
  health: number;
  summary: ScanSummary;
  results: SharedResult[];
  createdAt: string;
  expiresAt: string;
};

/** Trim a live scan result to what a public report needs: no redirect bodies, no timings. */
export function toShared(r: LinkResult): SharedResult {
  return {
    url: r.url,
    cls: r.cls,
    confidence: r.confidence,
    reasons: r.reasons.slice(0, 8).map((x) => x.slice(0, 400)),
    status: r.status,
    finalUrl: r.finalUrl,
    title: r.title?.slice(0, 200),
    citeDate: r.citeDate,
    citeSource: r.citeSource,
    occurrences: r.occurrences.slice(0, 20).map((o) => ({ doc: o.doc.slice(0, 300), line: o.line })),
    snapshot: r.snapshot,
    drift: r.drift,
    rdapRegistered: r.rdapRegistered,
  };
}

/** Health score: living counts fully, drifted half; restless and sealed are not scored. */
export function summarize(results: Pick<SharedResult, "cls">[]): ScanSummary {
  const s = Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<(typeof CLASSES)[number], number>;
  for (const r of results) s[r.cls]++;
  const scored = s.living + s.drifted + s.tombstone + s.ghost + s.zombie;
  const health = scored ? Math.round(((s.living + s.drifted * 0.5) / scored) * 100) : 100;
  return { ...s, total: results.length, health };
}

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz"; // no 0/1/l/o: readable aloud
/** 12-char unguessable id (60 bits). */
export function newReportId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = rand(12);
  let id = "";
  for (const b of bytes) id += ALPHABET[b & 31];
  return id;
}

export function isReportId(id: string): boolean {
  return /^[2-9a-km-np-z]{12}$/.test(id);
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Approximate text width for the badge font (Verdana 11px), good enough for layout. */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ilj.,:;|!'1 ]/.test(ch) ? 3.6 : /[mwMW@%]/.test(ch) ? 9.8 : /[A-Z0-9]/.test(ch) ? 7.6 : 6.6;
  return Math.ceil(w);
}

export function badgeTone(health: number | null): string {
  if (health === null) return "#6b7085";
  return health >= 85 ? "#3f8f3a" : health >= 60 ? "#b07a12" : "#b0281c";
}

/** Shields-style SVG badge: "lychgate | 87% alive · 3 dead". Pure and XML-safe. */
export function badgeSvg(opts: { health: number | null; dead?: number; label?: string }): string {
  const health = opts.health === null ? null : Math.max(0, Math.min(100, Math.round(opts.health)));
  const label = opts.label ?? "lychgate";
  const value = health === null ? "report expired" : `${health}% alive${opts.dead ? ` · ${opts.dead} dead` : ""}`;
  const lw = textWidth(label) + 26;
  const vw = textWidth(value) + 14;
  const W = lw + vw;
  const L = escapeXml(label);
  const V = escapeXml(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" role="img" aria-label="${L}: ${V}"><title>${L}: ${V}</title><linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-opacity=".12"/></linearGradient><clipPath id="r"><rect width="${W}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#14182b"/><rect x="${lw}" width="${vw}" height="20" fill="${badgeTone(health)}"/><rect width="${W}" height="20" fill="url(#g)"/></g><g fill="#f5b94a" transform="translate(5 3)"><path d="M0 6 Q4 5.5 7 2 Q10 5.5 14 6 L13 7 Q10 6.5 7 3.5 Q4 6.5 1 7Z"/><rect x="3" y="6.5" width="1.4" height="7.5"/><rect x="9.6" y="6.5" width="1.4" height="7.5"/><rect x="6.3" y="8" width="1.4" height="2.4" rx=".5"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${(lw + 18) / 2}" y="14" fill="#ece7dc">${L}</text><text x="${lw + vw / 2}" y="14">${V}</text></g></svg>`;
}
