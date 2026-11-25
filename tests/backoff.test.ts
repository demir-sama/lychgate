import { beforeEach, describe, expect, it } from "vitest";
import { __clearArchiveCaches } from "@/lib/archive/wayback";
import { classify } from "@/lib/classify/classify";
import { parseRetryAfter } from "@/lib/fetch/http";
import { HostLimiter } from "@/lib/fetch/limiter";
import { analyzeTarget, backoffMs, MAX_RATE_RETRIES, ScanContext } from "@/lib/scan/analyze";
import { isArchiveUrl } from "@/lib/util/url";
import { html, lorem, mockResolver, mockTransport } from "./helpers";

const target = (url: string) => ({ url, occurrences: [{ doc: "README.md", line: 1 }], citeSource: "none" as const });

describe("parseRetryAfter", () => {
  it("reads delta-seconds and HTTP dates, capped at 60 s", () => {
    expect(parseRetryAfter("3")).toBe(3);
    expect(parseRetryAfter("3600")).toBe(60);
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(parseRetryAfter("Mon, 16 Nov 2026 12:00:05 GMT", now)).toBe(5);
    expect(parseRetryAfter("Mon, 16 Nov 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("backoffMs", () => {
  it("grows exponentially, honours Retry-After and never exceeds 8.4 s", () => {
    expect(backoffMs(0, undefined, 0)).toBe(1500);
    expect(backoffMs(1, undefined, 0)).toBe(3000);
    expect(backoffMs(2, 2, 0)).toBe(2000);
    expect(backoffMs(5, undefined, 1)).toBe(8400);
    expect(backoffMs(0, 60, 1)).toBe(8400);
  });
});

describe("HostLimiter cooldown", () => {
  it("holds new requests to a cooled host but not to others", async () => {
    const l = new HostLimiter(8, 24);
    l.cool("https://github.com/a", 120);
    const t0 = Date.now();
    await l.run("https://example.com/", async () => null);
    expect(Date.now() - t0).toBeLessThan(60);
    await l.run("https://github.com/b", async () => null);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });
  it("never shortens an existing pause", () => {
    const l = new HostLimiter();
    l.cool("https://h.example/", 5000, 1000);
    l.cool("https://h.example/x", 10, 1000);
    expect(l.cooledUntil("https://h.example/")).toBe(6000);
  });
});

describe("analyzeTarget: rate limits", () => {
  beforeEach(() => __clearArchiveCaches());

  it("retries a 429 and classifies the page once it answers", async () => {
    let hits = 0;
    const transport = mockTransport({
      "https://busy.example/repo": () => {
        hits++;
        return hits <= 2 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : html(`<p>${lorem("repo", 120)}</p>`, "Repo");
      },
    });
    const r = await analyzeTarget(target("https://busy.example/repo"), new ScanContext({ transport, resolver: mockResolver() }));
    expect(r.cls).toBe("living");
    expect(r.status).toBe(200);
  });

  it(`gives up after ${MAX_RATE_RETRIES} retries and stays restless (never called dead)`, async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const transport = mockTransport({ "https://busy.example/x": () => new Response("no", { status: 429, headers: { "retry-after": "0" } }) }, calls);
    const r = await analyzeTarget(target("https://busy.example/x"), new ScanContext({ transport, resolver: mockResolver() }));
    expect(r.cls).toBe("restless");
    // HEAD + GET per attempt
    expect(calls.filter((c) => c.url === "https://busy.example/x")).toHaveLength(2 * (MAX_RATE_RETRIES + 1));
  });
});

describe("archived links", () => {
  beforeEach(() => __clearArchiveCaches());

  it("recognises archive URLs", () => {
    expect(isArchiveUrl("https://web.archive.org/web/20130929001850/http://linuxnote.net/x")).toBe(true);
    expect(isArchiveUrl("https://web.archive.org/web/2013/http://a.example/")).toBe(true);
    expect(isArchiveUrl("https://web.archive.org/")).toBe(false);
    expect(isArchiveUrl("https://archive.ph/AbCd1")).toBe(true);
    expect(isArchiveUrl("https://notarchive.ph.example.com/")).toBe(false);
    expect(isArchiveUrl("https://example.com/web/2013/x")).toBe(false);
    expect(isArchiveUrl("nope")).toBe(false);
  });

  it("a snapshot of a page that once showed a for-sale banner is not a zombie", async () => {
    const url = "https://web.archive.org/web/20130929001850/http://linuxnote.net/a";
    const transport = mockTransport({ [url]: html("<h1>This domain is for sale</h1><p>Buy this domain</p>", "linuxnote.net") });
    const r = await analyzeTarget(target(url), new ScanContext({ transport, resolver: mockResolver() }));
    expect(r.cls).toBe("living");
    expect(r.reasons[0]).toMatch(/archived copy/);
  });

  it("classifier: archived 2xx is living, archived 404 is still a tombstone, SSRF still wins", () => {
    expect(classify({ archived: true, status: 200 }).cls).toBe("living");
    expect(classify({ archived: true, status: 404 }).cls).toBe("tombstone");
    expect(classify({ archived: true, error: { kind: "ssrf", message: "x" } }).cls).toBe("sealed");
  });
});
