import { getDomain, getPublicSuffix } from "tldts";
import { safeFetch, type SafeFetchOptions } from "../fetch/http";
import { TtlCache } from "../util/cache";

export type RdapResult = { status: "found" | "not_found" | "unknown"; registered?: string; domain?: string; server?: string; note?: string };
type Deps = Pick<SafeFetchOptions, "transport" | "resolver">;

export function registrableDomain(host: string): string | null {
  return getDomain(host, { allowPrivateDomains: false }) ?? null;
}

/** Extract the registration date from an RDAP domain object. */
export function parseRdapRegistration(json: unknown): string | undefined {
  const events = (json as { events?: Array<{ eventAction?: string; eventDate?: string }> })?.events;
  if (!Array.isArray(events)) return undefined;
  const reg = events.find((e) => e?.eventAction === "registration" && typeof e.eventDate === "string");
  if (!reg) return undefined;
  const t = Date.parse(reg.eventDate!);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Find the RDAP base URL for a TLD from the IANA bootstrap registry. */
export function serverForTld(bootstrap: unknown, tld: string): string | null {
  const services = (bootstrap as { services?: Array<[string[], string[]]> })?.services;
  if (!Array.isArray(services)) return null;
  const t = tld.toLowerCase();
  for (const [tlds, urls] of services) {
    if (tlds.map((x) => x.toLowerCase()).includes(t)) {
      const https = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      return https ? (https.endsWith("/") ? https : https + "/") : null;
    }
  }
  return null;
}

let bootstrapPromise: Promise<unknown> | null = null;
let bootstrapAt = 0;
async function getBootstrap(deps: Deps) {
  if (!bootstrapPromise || Date.now() - bootstrapAt > 24 * 3600_000) {
    bootstrapAt = Date.now();
    bootstrapPromise = safeFetch("https://data.iana.org/rdap/dns.json", { ...deps, readBody: true, timeoutMs: 10_000, accept: "application/json", maxBytes: 1024 * 1024 })
      .then((r) => {
        if (r.status !== 200) throw new Error(`IANA bootstrap HTTP ${r.status}`);
        return JSON.parse(r.body ?? "{}");
      })
      .catch((e) => {
        bootstrapPromise = null;
        throw e;
      });
  }
  return bootstrapPromise;
}

const cache = new TtlCache<Promise<RdapResult>>(12 * 3600_000, 2000);

/** Look up a host's registrable domain in RDAP. Never throws; returns status "unknown" on any doubt. */
export function lookupRdap(host: string, deps: Deps = {}): Promise<RdapResult> {
  const domain = registrableDomain(host);
  if (!domain) return Promise.resolve({ status: "unknown", note: "no registrable domain" });
  return cache.wrap(domain, async (): Promise<RdapResult> => {
    try {
      const tld = getPublicSuffix(domain, { allowPrivateDomains: false })?.split(".").pop();
      if (!tld) return { status: "unknown", domain, note: "no TLD" };
      const server = serverForTld(await getBootstrap(deps), tld);
      if (!server) return { status: "unknown", domain, note: `no RDAP service for .${tld}` };
      const res = await safeFetch(`${server}domain/${encodeURIComponent(domain)}`, { ...deps, readBody: true, timeoutMs: 8_000, accept: "application/rdap+json, application/json" });
      if (res.status === 404) return { status: "not_found", domain, server };
      if (res.status !== 200) return { status: "unknown", domain, server, note: `RDAP HTTP ${res.status}` };
      return { status: "found", domain, server, registered: parseRdapRegistration(JSON.parse(res.body ?? "{}")) };
    } catch (err) {
      return { status: "unknown", domain, note: (err as Error).message };
    }
  });
}
