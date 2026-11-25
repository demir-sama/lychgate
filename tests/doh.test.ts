import { beforeEach, describe, expect, it } from "vitest";
import { __clearArchiveCaches } from "@/lib/archive/wayback";
import { __clearDohCache, confirmViaDoh, parseDohAnswer } from "@/lib/domain/doh";
import type { Resolver } from "@/lib/fetch/guard";
import { analyzeTarget, ScanContext } from "@/lib/scan/analyze";
import { mockResolver, mockTransport } from "./helpers";

/** Public resolver for everything except `busy`, which fails the way serverless resolvers do. */
const busyResolver = (busy: string): Resolver => {
  const base = mockResolver();
  return async (host) => {
    if (host === busy) throw Object.assign(new Error(`getaddrinfo EBUSY ${host}`), { code: "EBUSY" });
    return base(host);
  };
};
const target = (url: string) => ({ url, occurrences: [{ doc: "README.md", line: 1 }], citeSource: "none" as const });
const doh = (status: number, answer?: Array<{ type: number; data: string }>) => Response.json({ Status: status, ...(answer ? { Answer: answer } : {}) });

describe("parseDohAnswer", () => {
  it("maps DNS JSON answers", () => {
    expect(parseDohAnswer({ Status: 3 })).toBe("nxdomain");
    expect(parseDohAnswer({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] })).toBe("resolves");
    expect(parseDohAnswer({ Status: 0, Answer: [{ type: 5, data: "alias.example." }] })).toBe("resolves");
    expect(parseDohAnswer({ Status: 0 })).toBe("nxdomain");
    expect(parseDohAnswer({ Status: 2 })).toBe("unknown");
    expect(parseDohAnswer("junk")).toBe("unknown");
  });
});

describe("DNS-over-HTTPS second opinion", () => {
  beforeEach(() => {
    __clearDohCache();
    __clearArchiveCaches();
  });

  it("turns a transient resolver error into a Tombstone only when DoH confirms NXDOMAIN", async () => {
    const transport = mockTransport({ "https://dns.google/resolve*": doh(3), "https://data.iana.org/rdap/dns.json": Response.json({ services: [] }), "https://web.archive.org/*": Response.json([]) });
    const r = await analyzeTarget(target("https://gone-for-good.example/docs"), new ScanContext({ transport, resolver: busyResolver("gone-for-good.example") }));
    expect(r.cls).toBe("tombstone");
  });

  it("stays Restless when DoH says the name resolves (our resolver was just busy)", async () => {
    const transport = mockTransport({ "https://dns.google/resolve*": doh(0, [{ type: 1, data: "93.184.216.34" }]) });
    const r = await analyzeTarget(target("https://alive.example/docs"), new ScanContext({ transport, resolver: busyResolver("alive.example") }));
    expect(r.cls).toBe("restless");
  });

  it("stays Restless when DoH itself fails", async () => {
    const transport = mockTransport({ "https://dns.google/resolve*": 500 });
    const r = await analyzeTarget(target("https://flaky.example/"), new ScanContext({ transport, resolver: busyResolver("flaky.example") }));
    expect(r.cls).toBe("restless");
  });

  it("asks over the SSRF-guarded fetch and caches per host", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const transport = mockTransport({ "https://dns.google/resolve*": doh(3) }, calls);
    expect(await confirmViaDoh("Nope.Example.", { transport, resolver: mockResolver() })).toBe("nxdomain");
    expect(await confirmViaDoh("nope.example", { transport, resolver: mockResolver() })).toBe("nxdomain");
    expect(calls.map((c) => new URL(c.url).searchParams.get("type"))).toEqual(["A", "AAAA"]);
    expect(new URL(calls[0].url).searchParams.get("name")).toBe("nope.example");
  });

  it("is refused if dns.google ever resolved to a private address", async () => {
    const transport = mockTransport({ "https://dns.google/resolve*": doh(3) });
    expect(await confirmViaDoh("x.example", { transport, resolver: mockResolver({ "dns.google": ["10.0.0.8"] }) })).toBe("unknown");
  });
});
