import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify } from "@/lib/classify/classify";
import { movedOffsite } from "@/lib/classify/signals";

describe("moved off-site (scanner-classifier R5.12)", () => {
  it("flags a link folded into another site", () => {
    expect(movedOffsite("https://plus.google.com/", "https://workspaceupdates.googleblog.com/2023/04/new-community-features.html")).toEqual({ host: "workspaceupdates.googleblog.com" });
  });

  it("does not flag honest moves: same path on a new domain, www, https", () => {
    expect(movedOffsite("https://twitter.com/jack", "https://x.com/jack")).toBeNull();
    expect(movedOffsite("http://example.com/a/", "https://www.example.com/a")).toBeNull();
    expect(movedOffsite("https://example.com/docs", "https://example.com/v2/docs")).toBeNull();
    expect(movedOffsite("https://example.com/docs", undefined)).toBeNull();
  });

  it("property: a same-path host change is never drift", () => {
    fc.assert(
      fc.property(fc.domain(), fc.domain(), fc.webPath(), (a, b, p) => {
        const path = p.startsWith("/") ? p : `/${p}`;
        expect(movedOffsite(`https://${a}${path}`, `https://${b}${path}`)).toBeNull();
      }),
    );
  });

  it("classifies as Drifted (not dead) and names where it lands", () => {
    const v = classify({ status: 200, redirectCount: 2, finalUrl: "https://blog.example.org/post", movedOffsite: { host: "blog.example.org" } });
    expect(v.cls).toBe("drifted");
    expect(v.reasons[0]).toContain("blog.example.org");
  });

  it("matching content still wins: a moved page that says the same thing is Living", () => {
    const v = classify({ status: 200, movedOffsite: { host: "new.example" }, drift: { similarity: 0.95, snapshotTimestamp: "20200101000000" } });
    expect(v.cls).toBe("living");
  });
});
