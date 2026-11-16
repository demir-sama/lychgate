import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify, DEAD_CLASSES, fmtTs, THRESHOLDS, type Evidence } from "@/lib/classify/classify";

describe("classify: rules", () => {
  it("SSRF refusals are sealed, never fetched", () => {
    expect(classify({ error: { kind: "ssrf", message: "blocked" } }).cls).toBe("sealed");
  });
  it("404 and 410 are tombstones", () => {
    expect(classify({ status: 404 })).toMatchObject({ cls: "tombstone", confidence: 0.95 });
    expect(classify({ status: 410 })).toMatchObject({ cls: "tombstone", confidence: 0.99 });
  });
  it("NXDOMAIN is a tombstone; unregistered domains are flagged as a takeover risk", () => {
    expect(classify({ error: { kind: "dns", code: "ENOTFOUND", message: "x" } }).cls).toBe("tombstone");
    const v = classify({ error: { kind: "dns", code: "ENOTFOUND", message: "x" }, rdap: { status: "not_found" } });
    expect(v.cls).toBe("tombstone");
    expect(v.reasons[0]).toMatch(/takeover/);
  });
  it("temporary DNS failures, timeouts, TLS and bot-blocking are restless, not dead", () => {
    expect(classify({ error: { kind: "dns", code: "EAI_AGAIN", message: "x" } }).cls).toBe("restless");
    expect(classify({ error: { kind: "timeout", message: "x" } }).cls).toBe("restless");
    expect(classify({ error: { kind: "tls", message: "x" } }).cls).toBe("restless");
    for (const s of [401, 403, 429, 500, 502, 503, 999]) expect(classify({ status: s }).cls).toBe("restless");
    expect(classify({ status: 400 }).cls).toBe("restless");
    expect(classify({ status: 304 }).cls).toBe("restless");
    expect(classify({}).cls).toBe("restless");
  });
  it("parked pages are zombies even when they answer 200", () => {
    expect(classify({ status: 200, parked: { signature: "buy-this-domain" } }).cls).toBe("zombie");
  });
  it("domains registered after the cite date are zombies", () => {
    const ev: Evidence = { status: 200, citeDate: "2016-01-01T00:00:00Z", rdap: { status: "found", registered: "2021-03-04T00:00:00Z" } };
    expect(classify(ev).cls).toBe("zombie");
    expect(classify({ ...ev, rdap: { status: "found", registered: "2001-01-01T00:00:00Z" } }).cls).toBe("living");
    // within the one-day grace window
    expect(classify({ ...ev, rdap: { status: "found", registered: "2016-01-01T12:00:00Z" } }).cls).toBe("living");
    // bad dates are ignored
    expect(classify({ ...ev, rdap: { status: "found", registered: "nonsense" } }).cls).toBe("living");
  });
  it("soft-404 signals make a ghost, with combined confidence", () => {
    const probe = { status: 200, similarity: 0.97, lengthRatio: 0.95, titleMatch: true };
    expect(classify({ status: 200, softProbe: probe })).toMatchObject({ cls: "ghost", confidence: 0.8 });
    expect(classify({ status: 200, notFoundText: true, title: "Page not found" }).cls).toBe("ghost");
    expect(classify({ status: 200, redirectedToRoot: true }).cls).toBe("ghost");
    const all = classify({ status: 200, softProbe: probe, notFoundText: true, redirectedToRoot: true });
    expect(all.cls).toBe("ghost");
    expect(all.confidence).toBeCloseTo(0.95);
    expect(all.reasons).toHaveLength(3);
  });
  it("a random-path probe that 404s (or differs) is not a ghost", () => {
    expect(classify({ status: 200, softProbe: { status: 404, similarity: 0.99, lengthRatio: 1, titleMatch: true } }).cls).toBe("living");
    expect(classify({ status: 200, softProbe: { status: 200, similarity: 0.5, lengthRatio: 1, titleMatch: false } }).cls).toBe("living");
    expect(classify({ status: 200, softProbe: { status: 200, similarity: 0.95, lengthRatio: 0.3, titleMatch: false } }).cls).toBe("living");
  });
  it("low similarity to the cited snapshot means drifted", () => {
    const v = classify({ status: 200, drift: { similarity: 0.1, snapshotTimestamp: "20160826064145" } });
    expect(v.cls).toBe("drifted");
    expect(v.reasons[0]).toContain("2016-08-26");
    expect(classify({ status: 200, drift: { similarity: 0.5, snapshotTimestamp: "20160826064145" } }).cls).toBe("living");
  });
  it("matching the cited snapshot overrides weaker ghost signals", () => {
    expect(classify({ status: 200, redirectedToRoot: true, drift: { similarity: 0.95, snapshotTimestamp: "20200101000000" } }).cls).toBe("living");
  });
  it("fmtTs formats wayback timestamps", () => {
    expect(fmtTs("20160826064145")).toBe("2016-08-26");
    expect(fmtTs("abc")).toBe("abc");
  });
});

const arbEvidence2xx = fc.record(
  {
    status: fc.integer({ min: 200, max: 299 }),
    title: fc.string(),
    notFoundText: fc.boolean(),
    redirectedToRoot: fc.boolean(),
    redirectCount: fc.nat(5),
    softProbe: fc.record({ status: fc.integer({ min: 200, max: 599 }), similarity: fc.double({ min: 0, max: 1, noNaN: true }), lengthRatio: fc.double({ min: 0, max: 1, noNaN: true }), titleMatch: fc.boolean() }),
    citeDate: fc.constantFrom("2015-01-01T00:00:00Z", undefined),
    rdap: fc.record({ status: fc.constantFrom("found" as const, "unknown" as const), registered: fc.constantFrom("2001-01-01T00:00:00Z", undefined) }),
  },
  { requiredKeys: ["status"] },
);

describe("classify: properties", () => {
  it("never labels a 2xx whose content matches the cited snapshot as dead", () => {
    fc.assert(
      fc.property(arbEvidence2xx, fc.double({ min: THRESHOLDS.contentMatch, max: 1, noNaN: true }), (ev, sim) => {
        const v = classify({ ...(ev as Evidence), drift: { similarity: sim, snapshotTimestamp: "20150101000000" } });
        expect(DEAD_CLASSES.has(v.cls)).toBe(false);
        expect(v.cls).toBe("living");
      }),
    );
  });
  it("any SSRF error is sealed regardless of other evidence", () => {
    fc.assert(
      fc.property(arbEvidence2xx, (ev) => {
        expect(classify({ ...(ev as Evidence), error: { kind: "ssrf", message: "x" } }).cls).toBe("sealed");
      }),
    );
  });
  it("confidence is always within [0,1] and there is always a reason", () => {
    fc.assert(
      fc.property(arbEvidence2xx, fc.option(fc.double({ min: 0, max: 1, noNaN: true })), (ev, sim) => {
        const v = classify({ ...(ev as Evidence), drift: sim === null ? undefined : { similarity: sim, snapshotTimestamp: "20150101000000" } });
        expect(v.confidence).toBeGreaterThanOrEqual(0);
        expect(v.confidence).toBeLessThanOrEqual(1);
        expect(v.reasons.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("classify: false-positive guards found in live scans", () => {
  it("transient resolver errors (EBUSY, SERVFAIL) are restless, not tombstones", () => {
    for (const code of ["EBUSY", "ESERVFAIL", "ETIMEOUT", "EAI_AGAIN", undefined]) {
      expect(classify({ error: { kind: "dns", code, message: "x" } }).cls).toBe("restless");
    }
    expect(classify({ error: { kind: "dns", code: "ENODATA", message: "x" } }).cls).toBe("tombstone");
  });
  it("an identical made-up URL on a thin page (SPA shell) is restless, not a ghost", () => {
    const v = classify({ status: 200, softProbe: { status: 200, similarity: 1, lengthRatio: 1, titleMatch: true, liveTextLength: 40 } });
    expect(v.cls).toBe("restless");
    expect(v.reasons[0]).toMatch(/JavaScript app shell/);
    expect(classify({ status: 200, softProbe: { status: 200, similarity: 1, lengthRatio: 1, titleMatch: true, liveTextLength: 5000 } }).cls).toBe("ghost");
    // thin page that also says "not found" is still a ghost
    expect(classify({ status: 200, notFoundText: true, softProbe: { status: 200, similarity: 1, lengthRatio: 1, titleMatch: true, liveTextLength: 40 } }).cls).toBe("ghost");
  });
});
