import type { LinkClass } from "../classify/classify";
import type { RedirectHop } from "../fetch/http";

export type ScanInput =
  | { kind: "site"; url: string; sitemap?: boolean; citeDate?: string }
  | { kind: "github"; repo: string }
  | { kind: "markdown"; text: string; citeDate?: string }
  /** Files already read from a checked-out workspace (the GitHub Action). Never accepted from the web. */
  | { kind: "docs"; docs: Doc[]; dates?: DocDates; source?: string };

/** Per document path, per raw link text: when git first saw it. */
export type DocDates = Record<string, Record<string, { date: string; exact: boolean }>>;

export type Occurrence = { doc: string; line: number };

export type Target = {
  /** canonical URL (dedupe key; also what we fetch) */
  url: string;
  occurrences: Occurrence[];
  /** ISO date the link was cited (added), if known */
  citeDate?: string;
  citeSource?: "git" | "user" | "none";
  citeExact?: boolean;
};

export type Doc = { path: string; content: string };

export type LinkResult = {
  url: string;
  cls: LinkClass;
  confidence: number;
  reasons: string[];
  status?: number;
  finalUrl?: string;
  redirects: RedirectHop[];
  title?: string;
  citeDate?: string;
  citeSource?: Target["citeSource"];
  occurrences: Occurrence[];
  snapshot?: { timestamp: string; url: string; beforeCite: boolean };
  drift?: number;
  rdapRegistered?: string;
  ms: number;
};

export type ScanSummary = Record<LinkClass, number> & { total: number; health: number };

export type ScanEvent =
  | { type: "status"; message: string }
  | { type: "meta"; source: string; total: number; found: number; capped: boolean; docs: Doc[]; warnings: string[] }
  | { type: "result"; result: LinkResult }
  | { type: "done"; summary: ScanSummary; ms: number }
  | { type: "error"; message: string };

export const MAX_LINKS = 300;
