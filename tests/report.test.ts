import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ReportInputSchema, badgeSvg, escapeXml, isReportId, newReportId, summarize, toShared } from "@/lib/report/report";
import type { LinkResult } from "@/lib/scan/types";

const CLASSES = ["living", "tombstone", "ghost", "drifted", "zombie", "restless", "sealed"] as const;

const result = (over: Partial<LinkResult> = {}): LinkResult => ({
  url: "https://example.com/a",
  cls: "tombstone",
  confidence: 0.9,
  reasons: ["Answered 404 Not Found."],
  status: 404,
  redirects: [{ status: 301, from: "http://example.com/a", to: "https://example.com/a" }],
  occurrences: [{ doc: "README.md", line: 3 }],
  snapshot: { timestamp: "20190501000000", url: "https://web.archive.org/web/20190501000000/https://example.com/a", beforeCite: true },
  ms: 120,
  ...over,
});

describe("shared reports (graveyard-ui R6.1)", () => {
  it("toShared drops redirects and timings and passes the schema", () => {
    const s = toShared(result());
    expect(s).not.toHaveProperty("redirects");
    expect(s).not.toHaveProperty("ms");
    expect(ReportInputSchema.safeParse({ source: "owner/repo", results: [s] }).success).toBe(true);
  });

  it("rejects unknown classes, empty reports and oversized ones", () => {
    const s = toShared(result());
    expect(ReportInputSchema.safeParse({ source: "x", results: [{ ...s, cls: "vampire" }] }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ source: "x", results: [] }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ source: "x", results: Array(301).fill(s) }).success).toBe(false);
  });

  it("property: health is recomputed server-side, stays in 0..100, and ignores restless/sealed", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...CLASSES), { maxLength: 300 }), (classes) => {
        const sum = summarize(classes.map((cls) => ({ cls })));
        expect(sum.total).toBe(classes.length);
        expect(sum.health).toBeGreaterThanOrEqual(0);
        expect(sum.health).toBeLessThanOrEqual(100);
        const withNoise = summarize([...classes, "restless", "sealed"].map((cls) => ({ cls: cls as (typeof CLASSES)[number] })));
        expect(withNoise.health).toBe(sum.health);
      }),
    );
  });

  it("all-living is 100, all-dead is 0, drifted counts half", () => {
    expect(summarize([{ cls: "living" }]).health).toBe(100);
    expect(summarize([{ cls: "tombstone" }, { cls: "zombie" }]).health).toBe(0);
    expect(summarize([{ cls: "drifted" }]).health).toBe(50);
  });

  it("ids are 12 readable characters and validated strictly", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newReportId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isReportId(id)).toBe(true);
    expect(isReportId("abc")).toBe(false);
    expect(isReportId("../../etc/pw")).toBe(false);
    expect(isReportId("0000000000oo")).toBe(false);
  });
});

describe("README badge", () => {
  it("property: output is XML-safe for any label", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: -50, max: 200 }), (label, health) => {
        const svg = badgeSvg({ health, label });
        const text = svg.replace(/<[^>]+>/g, "");
        expect(text).not.toMatch(/[<>]/);
        expect(svg).toContain(escapeXml(label));
        const pct = Number(/(\d+)% alive/.exec(svg)![1]);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }),
    );
  });

  it("colour tracks health and expired reports are grey", () => {
    expect(badgeSvg({ health: 95 })).toContain("#3f8f3a");
    expect(badgeSvg({ health: 70 })).toContain("#b07a12");
    expect(badgeSvg({ health: 10, dead: 4 })).toContain("4 dead");
    expect(badgeSvg({ health: null })).toContain("report expired");
  });
});
