import { safeFetch, type SafeFetchOptions } from "../fetch/http";
import { TtlCache } from "../util/cache";

type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;
export type DohVerdict = "nxdomain" | "resolves" | "unknown";

/** DNS JSON API (RFC 8427 style, as served by dns.google). Status 3 = NXDOMAIN. */
export const DOH_ENDPOINT = "https://dns.google/resolve";

export function parseDohAnswer(json: unknown): DohVerdict {
  const j = json as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  if (typeof j?.Status !== "number") return "unknown";
  if (j.Status === 3) return "nxdomain";
  if (j.Status === 0) return Array.isArray(j.Answer) && j.Answer.some((a) => a?.type === 1 || a?.type === 28 || a?.type === 5) ? "resolves" : "nxdomain";
  return "unknown";
}

let cache = new TtlCache<Promise<DohVerdict>>(10 * 60_000, 2000);

/**
 * Second opinion when the platform resolver gives a transient error (serverless
 * resolvers answer EBUSY/EAI_AGAIN under load, sometimes for names that simply
 * don't exist). Only used to *confirm* NXDOMAIN; never to pick an IP to connect to,
 * so the SSRF guard's own resolution stays the only source of connect addresses.
 */
export function confirmViaDoh(hostname: string, deps: Deps = {}): Promise<DohVerdict> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const hit = cache.get(host);
  if (hit) return hit;
  const p = (async (): Promise<DohVerdict> => {
    for (const type of ["A", "AAAA"]) {
      const res = await safeFetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(host)}&type=${type}`, {
        ...deps,
        accept: "application/dns-json, application/json",
        readBody: true,
        maxBytes: 64 * 1024,
        timeoutMs: 5000,
      });
      if (res.status !== 200 || !res.body) return "unknown";
      let v: DohVerdict;
      try {
        v = parseDohAnswer(JSON.parse(res.body));
      } catch {
        return "unknown";
      }
      if (v !== "nxdomain") return v;
    }
    return "nxdomain";
  })().catch((): DohVerdict => "unknown");
  cache.set(host, p);
  return p;
}

export function __clearDohCache() {
  cache = new TtlCache<Promise<DohVerdict>>(10 * 60_000, 2000);
}
