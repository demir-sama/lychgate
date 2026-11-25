import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalUrl, hostOf, isHttpUrl, trimBareUrl, waybackUrl } from "@/lib/util/url";

describe("canonicalUrl", () => {
  it("normalises scheme/host/port/fragment", () => {
    expect(canonicalUrl("HTTPS://Example.COM:443/a/B?x=1#frag")).toBe("https://example.com/a/B?x=1");
    expect(canonicalUrl("http://example.com.")).toBe("http://example.com/");
    expect(canonicalUrl("http://example.com/?")).toBe("http://example.com/");
    expect(canonicalUrl("mailto:a@b.c")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
    expect(canonicalUrl("/relative")).toBeNull();
  });
  it("property: idempotent", () => {
    fc.assert(
      fc.property(fc.webUrl({ withFragments: true, withQueryParameters: true }), (u) => {
        const once = canonicalUrl(u);
        if (once === null) return;
        expect(canonicalUrl(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });
});

describe("helpers", () => {
  it("trimBareUrl drops prose punctuation and unbalanced brackets", () => {
    expect(trimBareUrl("https://a.com/x.")).toBe("https://a.com/x");
    expect(trimBareUrl("https://a.com/x),")).toBe("https://a.com/x");
    expect(trimBareUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });
  it("isHttpUrl / hostOf / waybackUrl", () => {
    expect(isHttpUrl("https://a.com")).toBe(true);
    expect(isHttpUrl("ftp://a.com")).toBe(false);
    expect(isHttpUrl("nope")).toBe(false);
    expect(hostOf("https://A.com/x")).toBe("a.com");
    expect(hostOf("nope")).toBeNull();
    expect(waybackUrl("20200101000000", "https://a.com/")).toBe("https://web.archive.org/web/20200101000000/https://a.com/");
    expect(waybackUrl("20200101000000", "https://a.com/", true)).toBe("https://web.archive.org/web/20200101000000id_/https://a.com/");
  });
});
