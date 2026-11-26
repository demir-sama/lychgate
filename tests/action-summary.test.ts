import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LINK_CLASSES, type LinkClass } from "@/lib/classify/classify";
import { summarize } from "@/lib/scan/engine";
import type { LinkResult } from "@/lib/scan/types";
import { parseInputs } from "../action/src/inputs";
import { deadCount, failDecision, renderSummary } from "../action/src/summary";

const res = (cls: LinkClass, url: string, extra: Partial<LinkResult> = {}): LinkResult => ({
  url,
  cls,
  confidence: 0.9,
  reasons: ["It answered 404."],
  redirects: [],
  occurrences: [{ doc: "README.md", line: 3 }],
  ms: 1,
  ...extra,
});
const clsArb = fc.constantFrom(...LINK_CLASSES);
const ARGS = (results: LinkResult[], over: Record<string, unknown> = {}) => ({
  source: "workspace",
  summary: summarize(results),
  results,
  warnings: [] as string[],
  failOn: new Set<LinkClass>(["tombstone", "zombie"]),
  ...over,
});

describe("parseInputs (R5.3, R5.9)", () => {
  it("uses the documented defaults", () => {
    const r = parseInputs({});
    expect(r).toEqual({ ok: true, value: { paths: ["**/*.md"], maxFiles: 20, failOn: new Set(["tombstone", "zombie"]), citeDates: "git" } });
  });
  it("splits paths on lines and commas, reads fail-on and cite-dates", () => {
    const r = parseInputs({ INPUT_PATHS: "docs/**\n!docs/old/**, README.md", "INPUT_FAIL-ON": "Ghost, drifted", "INPUT_CITE-DATES": "none", "INPUT_MAX-FILES": "50" });
    expect(r).toEqual({ ok: true, value: { paths: ["docs/**", "!docs/old/**", "README.md"], maxFiles: 50, failOn: new Set(["ghost", "drifted"]), citeDates: "none" } });
  });
  it("an empty fail-on means never fail", () => {
    const r = parseInputs({ "INPUT_FAIL-ON": "  " });
    expect(r.ok && r.value.failOn.size).toBe(0);
  });
  it.each([
    [{ "INPUT_FAIL-ON": "living" }, "fail-on"],
    [{ "INPUT_FAIL-ON": "tombstone,bogus" }, "fail-on"],
    [{ "INPUT_MAX-FILES": "0" }, "max-files"],
    [{ "INPUT_MAX-FILES": "51" }, "max-files"],
    [{ "INPUT_MAX-FILES": "abc" }, "max-files"],
    [{ "INPUT_CITE-DATES": "sometimes" }, "cite-dates"],
    [{ INPUT_PATHS: "../**" }, "paths"],
  ])("refuses %j and names %s", (env, name) => {
    const r = parseInputs(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(name);
  });
});

describe("failDecision (R5.9, R5.11)", () => {
  it("fails iff some result has a class in failOn", () => {
    fc.assert(
      fc.property(fc.array(clsArb, { maxLength: 12 }), fc.subarray([...LINK_CLASSES].filter((c) => c !== "living")), (classes, on) => {
        const results = classes.map((c, i) => res(c, `https://e.example/${i}`));
        const d = failDecision(results, new Set(on));
        expect(d.fail).toBe(results.some((r) => on.includes(r.cls as never)));
        expect(d.offending.every((r) => on.includes(r.cls as never))).toBe(true);
      }),
    );
  });
  it("an empty set never fails", () => {
    expect(failDecision([res("tombstone", "https://a.example/")], new Set()).fail).toBe(false);
  });
});

describe("deadCount (R5.8)", () => {
  it("counts tombstone, ghost and zombie only", () => {
    const rs = (["tombstone", "ghost", "zombie", "drifted", "restless", "sealed", "living"] as LinkClass[]).map((c, i) => res(c, `https://e.example/${i}`));
    expect(deadCount(rs)).toBe(3);
  });
});

describe("renderSummary (R5.7)", () => {
  it("is a clean one-liner when nothing is wrong", () => {
    const md = renderSummary(ARGS([res("living", "https://ok.example/")]));
    expect(md).toContain("Lychgate link check");
    expect(md).toContain("health 100");
    expect(md).toMatch(/no dead|nothing/i);
    expect(md).not.toContain("| Location");
  });
  it("lists dead and drifted rows worst first with file:line and the snapshot", () => {
    const rs = [
      res("drifted", "https://drift.example/"),
      res("tombstone", "https://dead.example/", { snapshot: { timestamp: "20150301000000", url: "https://web.archive.org/web/20150301000000/https://dead.example/", beforeCite: true } }),
      res("zombie", "https://zombie.example/"),
      res("living", "https://ok.example/"),
      res("restless", "https://slow.example/"),
    ];
    const md = renderSummary(ARGS(rs));
    expect(md.indexOf("zombie.example")).toBeLessThan(md.indexOf("dead.example"));
    expect(md.indexOf("dead.example")).toBeLessThan(md.indexOf("drift.example"));
    expect(md).toContain("README.md:3");
    expect(md).toContain("https://web.archive.org/web/20150301000000/https://dead.example/");
    expect(md).not.toContain("ok.example");
    expect(md).not.toContain("slow.example");
    expect(md).toMatch(/zombie[^\n]*security risk/i);
  });
  it("adds a fail-on class to the table", () => {
    const md = renderSummary(ARGS([res("restless", "https://slow.example/")], { failOn: new Set<LinkClass>(["restless"]) }));
    expect(md).toContain("slow.example");
  });
  it("shows +N more locations and the scan warnings", () => {
    const r = res("tombstone", "https://dead.example/", { occurrences: [{ doc: "a.md", line: 1 }, { doc: "b.md", line: 2 }, { doc: "c.md", line: 9 }] });
    const md = renderSummary(ARGS([r], { warnings: ["The clone is shallow."] }));
    expect(md).toContain("a.md:1");
    expect(md).toContain("+2 more");
    expect(md).toContain("The clone is shallow.");
  });
  it("never lets a hostile URL or reason break the table", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (reason, path) => {
        const r = res("tombstone", `https://x.example/${path}`, { reasons: [reason] });
        const md = renderSummary(ARGS([r]));
        const row = md.split("\n").filter((l) => l.startsWith("| ") && l.includes("x.example"));
        expect(row).toHaveLength(1);
        // header columns = 5 cells; unescaped pipes would add more
        expect(row[0].replace(/\\\|/g, "").replace(/`[^`]*`/g, "``").split("|").length).toBe(7);
        expect(md).not.toContain("<script");
      }),
    );
  });
  it("stays under the byte cap and says how many rows it left out", () => {
    const rs = Array.from({ length: 400 }, (_, i) => res("tombstone", `https://dead.example/${i}`, { reasons: ["x".repeat(300)] }));
    const md = renderSummary(ARGS(rs, { maxBytes: 20_000 }));
    expect(Buffer.byteLength(md)).toBeLessThanOrEqual(20_000);
    expect(md).toMatch(/\d+ more rows? left out/);
  });
});
