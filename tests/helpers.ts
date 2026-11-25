import type { Resolver } from "@/lib/fetch/guard";
import type { Transport, TransportInit } from "@/lib/fetch/http";

export const PUBLIC_IP = "93.184.216.34";

/** Resolver: every host is public unless overridden; `null` means NXDOMAIN. */
export function mockResolver(overrides: Record<string, string[] | null> = {}): Resolver {
  return async (host) => {
    if (host in overrides) {
      const v = overrides[host];
      if (v === null) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return v.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    }
    return [{ address: PUBLIC_IP, family: 4 }];
  };
}

export type Route = (url: URL, init: TransportInit) => Response | Promise<Response>;

/** Transport routed by exact URL (without hash), then by prefix, else 404. Records calls. */
export function mockTransport(routes: Record<string, Route | Response | number>, calls: Array<{ url: string; method: string }> = []): Transport {
  return async (url, init) => {
    calls.push({ url, method: init.method });
    const u = new URL(url);
    let r = routes[u.href];
    if (r === undefined) {
      const key = Object.keys(routes)
        .filter((k) => k.endsWith("*") && u.href.startsWith(k.slice(0, -1)))
        .sort((a, b) => b.length - a.length)[0];
      if (key) r = routes[key];
    }
    if (r === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof r === "number") return new Response(null, { status: r });
    if (r instanceof Response) return r.clone();
    return r(u, init);
  };
}

export const html = (body: string, title = "Page", status = 200, headers: Record<string, string> = {}) =>
  new Response(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });

export const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

export const lorem = (seed: string, n = 120) =>
  Array.from({ length: n }, (_, i) => `${seed}${(i * 7919) % 97}word${i % 13}`).join(" ");
