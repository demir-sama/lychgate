import { safeFetch, type SafeFetchOptions } from "../fetch/http";
import { TtlCache } from "../util/cache";
import { waybackUrl } from "../util/url";

export type Snapshot = { timestamp: string; status: string; original: string; url: string };

/** yyyymmddhhmmss for a Date (UTC). */
export function toWaybackTimestamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function fromWaybackTimestamp(ts: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(ts);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
}

/**
 * Pick the snapshot to resurrect from.
 * With a cite date: the latest 200 snapshot taken at or before that date, or null.
 * Without one: the latest 200 snapshot (best surviving copy).
 */
export function pickSnapshot(snaps: Snapshot[], citeDate?: Date | null): Snapshot | null {
  const ok = snaps.filter((s) => s.status === "200" && /^\d{14}$/.test(s.timestamp));
  if (!ok.length) return null;
  if (citeDate) {
    const limit = toWaybackTimestamp(citeDate);
    let best: Snapshot | null = null;
    for (const s of ok) if (s.timestamp <= limit && (!best || s.timestamp > best.timestamp)) best = s;
    return best;
  }
  return ok.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
}

/** Parse CDX JSON output (`output=json`, first row is the header). */
export function parseCdx(json: unknown): Snapshot[] {
  if (!Array.isArray(json) || json.length < 2) return [];
  const header = json[0] as string[];
  const ti = header.indexOf("timestamp");
  const si = header.indexOf("statuscode");
  const oi = header.indexOf("original");
  if (ti < 0 || oi < 0) return [];
  return (json.slice(1) as string[][])
    .filter((r) => Array.isArray(r) && typeof r[ti] === "string")
    .map((r) => ({ timestamp: r[ti], status: si >= 0 ? r[si] : "200", original: r[oi], url: waybackUrl(r[ti], r[oi]) }));
}

const cdxCache = new TtlCache<Promise<Snapshot[]>>(6 * 3600_000, 3000);
const textCache = new TtlCache<Promise<string | null>>(6 * 3600_000, 300);

export type ArchiveDeps = Pick<SafeFetchOptions, "transport" | "resolver">;

async function cdxQuery(url: string, params: Record<string, string>, deps: ArchiveDeps): Promise<Snapshot[]> {
  const q = new URLSearchParams({ url, output: "json", fl: "timestamp,statuscode,original", filter: "statuscode:200", ...params });
  const res = await safeFetch(`https://web.archive.org/cdx/search/cdx?${q}`, {
    ...deps,
    readBody: true,
    timeoutMs: 12_000,
    accept: "application/json",
    maxBytes: 256 * 1024,
  });
  if (res.status !== 200) throw new Error(`CDX HTTP ${res.status}`);
  const body = (res.body ?? "").trim();
  if (!body) return [];
  return parseCdx(JSON.parse(body));
}

/** Availability API fallback: closest snapshot to a timestamp (either side). */
async function availability(url: string, ts: string | undefined, deps: ArchiveDeps): Promise<Snapshot[]> {
  const q = new URLSearchParams({ url });
  if (ts) q.set("timestamp", ts);
  const res = await safeFetch(`https://archive.org/wayback/available?${q}`, { ...deps, readBody: true, timeoutMs: 10_000, accept: "application/json" });
  if (res.status !== 200) throw new Error(`availability HTTP ${res.status}`);
  const j = JSON.parse(res.body ?? "{}") as { archived_snapshots?: { closest?: { status?: string; timestamp?: string; available?: boolean } } };
  const c = j.archived_snapshots?.closest;
  if (!c?.timestamp || !c.available) return [];
  return [{ timestamp: c.timestamp, status: c.status ?? "200", original: url, url: waybackUrl(c.timestamp, url) }];
}

/**
 * Find the best snapshot for `url`: latest 200 at/before `citeDate`, or the latest 200 overall.
 * Results are cached per (url, cite day).
 */
export async function findSnapshot(url: string, citeDate: Date | null | undefined, deps: ArchiveDeps = {}): Promise<{ snapshot: Snapshot | null; source: "cdx" | "availability" | "none"; error?: string }> {
  const day = citeDate ? toWaybackTimestamp(citeDate).slice(0, 8) : "latest";
  const key = `${url}|${day}`;
  try {
    const snaps = await cdxCache.wrap(key, () =>
      cdxQuery(url, citeDate ? { to: toWaybackTimestamp(citeDate), limit: "-3" } : { limit: "-3" }, deps),
    );
    const snap = pickSnapshot(snaps, citeDate);
    if (snap) return { snapshot: snap, source: "cdx" };
    if (citeDate) return { snapshot: null, source: "none" };
  } catch (err) {
    // CDX is occasionally slow or 5xx; fall back to the availability API.
    try {
      const snaps = await availability(url, citeDate ? toWaybackTimestamp(citeDate) : undefined, deps);
      return { snapshot: pickSnapshot(snaps, citeDate), source: snaps.length ? "availability" : "none" };
    } catch (err2) {
      return { snapshot: null, source: "none", error: `${(err as Error).message}; ${(err2 as Error).message}` };
    }
  }
  return { snapshot: null, source: "none" };
}

/** Raw archived HTML for a snapshot (no Wayback toolbar), capped and cached. */
export async function fetchSnapshotHtml(snap: Snapshot, deps: ArchiveDeps = {}): Promise<string | null> {
  return textCache.wrap(`${snap.timestamp}|${snap.original}`, async () => {
    const res = await safeFetch(waybackUrl(snap.timestamp, snap.original, true), { ...deps, readBody: true, timeoutMs: 12_000, maxBytes: 512 * 1024 });
    if (res.status !== 200) return null;
    return res.body ?? null;
  });
}

export function __clearArchiveCaches() {
  // test helper
  (cdxCache as unknown as { map: Map<string, unknown> }).map.clear();
  (textCache as unknown as { map: Map<string, unknown> }).map.clear();
}
