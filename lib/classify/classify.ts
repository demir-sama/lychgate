import type { FetchErrorKind } from "../fetch/http";

export const LINK_CLASSES = ["living", "tombstone", "ghost", "drifted", "zombie", "restless", "sealed"] as const;
export type LinkClass = (typeof LINK_CLASSES)[number];
/** Classes that mean "the cited content is gone". */
export const DEAD_CLASSES: ReadonlySet<LinkClass> = new Set(["tombstone", "ghost"]);
/** Classes that should be offered a resurrection. */
export const NEEDS_RESURRECTION: ReadonlySet<LinkClass> = new Set(["tombstone", "ghost", "zombie", "drifted"]);

export const THRESHOLDS = {
  /** snapshot-vs-live cosine at/above which the content "matches" the citation */
  contentMatch: 0.8,
  /** snapshot-vs-live cosine below which we call the page drifted */
  drift: 0.35,
  /** live-vs-random-path cosine at/above which the page is a soft-404 */
  softProbe: 0.9,
  /** length ratio needed alongside softProbe similarity */
  softProbeLength: 0.8,
};

export type Evidence = {
  status?: number;
  error?: { kind: FetchErrorKind; code?: string; message: string };
  finalUrl?: string;
  redirectCount?: number;
  title?: string;
  notFoundText?: boolean;
  redirectedToRoot?: boolean;
  softProbe?: { status: number; similarity: number; lengthRatio: number; titleMatch: boolean };
  parked?: { signature: string };
  rdap?: { status: "found" | "not_found" | "unknown"; registered?: string };
  citeDate?: string;
  drift?: { similarity: number; snapshotTimestamp: string };
};

export type Verdict = { cls: LinkClass; confidence: number; reasons: string[] };

const round = (n: number) => Math.round(n * 100) / 100;

function registeredAfterCite(ev: Evidence): boolean {
  if (!ev.rdap?.registered || !ev.citeDate) return false;
  const reg = Date.parse(ev.rdap.registered);
  const cite = Date.parse(ev.citeDate);
  if (Number.isNaN(reg) || Number.isNaN(cite)) return false;
  return reg > cite + 24 * 3600 * 1000; // one-day grace for timezones
}

/**
 * Pure decision function: evidence in, verdict out. All network work happens
 * before this, so it is exhaustively unit/property testable.
 */
export function classify(ev: Evidence): Verdict {
  const reasons: string[] = [];

  if (ev.error?.kind === "ssrf") {
    return { cls: "sealed", confidence: 1, reasons: [`Refused to fetch: ${ev.error.message}`] };
  }

  if (ev.parked) {
    return {
      cls: "zombie",
      confidence: 0.9,
      reasons: [`Parked / for-sale page signature (${ev.parked.signature}). Someone else controls this domain now — do not send readers there.`],
    };
  }

  if (registeredAfterCite(ev)) {
    return {
      cls: "zombie",
      confidence: 0.8,
      reasons: [
        `Domain registered ${ev.rdap!.registered!.slice(0, 10)}, after the link was cited (${ev.citeDate!.slice(0, 10)}). It was likely dropped and re-registered by a new owner.`,
      ],
    };
  }

  if (ev.error) {
    const { kind, code } = ev.error;
    if (kind === "dns" && code !== "EAI_AGAIN") {
      if (ev.rdap?.status === "not_found") {
        return {
          cls: "tombstone",
          confidence: 0.97,
          reasons: ["The domain no longer resolves and is not registered (RDAP 404). Anyone could buy it — a takeover risk if left linked."],
        };
      }
      return { cls: "tombstone", confidence: 0.85, reasons: [`Domain does not resolve (${code ?? "DNS failure"}).`] };
    }
    return {
      cls: "restless",
      confidence: 0.3,
      reasons: [`Could not confirm: ${kind}${code ? ` (${code})` : ""}. It may be down temporarily or blocking bots.`],
    };
  }

  const status = ev.status ?? 0;
  if (status === 404 || status === 410) {
    return { cls: "tombstone", confidence: status === 410 ? 0.99 : 0.95, reasons: [`HTTP ${status} ${status === 410 ? "Gone" : "Not Found"}.`] };
  }
  if (status === 401 || status === 403 || status === 429 || status === 999 || status >= 500 || status === 0) {
    return {
      cls: "restless",
      confidence: 0.3,
      reasons: [`HTTP ${status || "no status"}: the server refused or failed. Often bot-blocking or a temporary outage, so we don't call it dead.`],
    };
  }
  if (status >= 400) {
    return { cls: "restless", confidence: 0.4, reasons: [`HTTP ${status}: unusual client error; needs a human look.`] };
  }
  if (status >= 300) {
    return { cls: "restless", confidence: 0.3, reasons: [`HTTP ${status} without a usable redirect.`] };
  }

  // 2xx from here on.
  if (ev.drift && ev.drift.similarity >= THRESHOLDS.contentMatch) {
    return {
      cls: "living",
      confidence: round(Math.min(0.99, 0.7 + ev.drift.similarity * 0.3)),
      reasons: [`Live, and ${Math.round(ev.drift.similarity * 100)}% similar to the snapshot from when it was cited.`],
    };
  }

  const ghostSignals: Array<[number, string]> = [];
  if (ev.softProbe && ev.softProbe.status >= 200 && ev.softProbe.status < 300 && ev.softProbe.similarity >= THRESHOLDS.softProbe && ev.softProbe.lengthRatio >= THRESHOLDS.softProbeLength) {
    ghostSignals.push([0.8, `Looks the same as a made-up URL on the same site (${Math.round(ev.softProbe.similarity * 100)}% similar${ev.softProbe.titleMatch ? ", same title" : ""}), so the server answers 200 for pages that don't exist.`]);
  }
  if (ev.notFoundText) ghostSignals.push([0.75, `Returns 200 but the page says it is missing${ev.title ? ` ("${ev.title.slice(0, 80)}")` : ""}.`]);
  if (ev.redirectedToRoot) ghostSignals.push([0.65, "A deep link now redirects to the site's home page."]);
  if (ghostSignals.length) {
    ghostSignals.sort((a, b) => b[0] - a[0]);
    const conf = Math.min(0.95, ghostSignals[0][0] + 0.08 * (ghostSignals.length - 1));
    return { cls: "ghost", confidence: round(conf), reasons: ghostSignals.map((g) => g[1]) };
  }

  if (ev.drift && ev.drift.similarity < THRESHOLDS.drift) {
    const conf = 0.5 + (THRESHOLDS.drift - ev.drift.similarity) / THRESHOLDS.drift / 2;
    return {
      cls: "drifted",
      confidence: round(Math.min(0.9, conf)),
      reasons: [`Live, but only ${Math.round(ev.drift.similarity * 100)}% similar to the snapshot from ${fmtTs(ev.drift.snapshotTimestamp)}, near when it was cited. The page may no longer say what you cited.`],
    };
  }

  reasons.push(`HTTP ${status}${ev.redirectCount ? ` after ${ev.redirectCount} redirect${ev.redirectCount > 1 ? "s" : ""}` : ""}.`);
  if (ev.drift) reasons.push(`${Math.round(ev.drift.similarity * 100)}% similar to the snapshot from when it was cited (some change, not enough to call it drifted).`);
  return { cls: "living", confidence: ev.drift ? 0.7 : 0.8, reasons };
}

export function fmtTs(ts: string): string {
  if (!/^\d{8}/.test(ts)) return ts;
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}
