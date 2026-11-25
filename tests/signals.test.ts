import { describe, expect, it } from "vitest";
import { cosineSimilarity, lengthRatio, parseHtml, tokenize } from "@/lib/classify/html";
import { detectParked, looksLikeNotFound, redirectedToRoot } from "@/lib/classify/signals";
import fc from "fast-check";

describe("detectParked", () => {
  it.each([
    "<h1>This domain is for sale!</h1>",
    "<p>Buy this domain today</p>",
    "<p>The domain coolsite.com may be for sale. Click here to inquire.</p>",
    "<p>Parked free, courtesy of GoDaddy.com</p>",
    '<script src="https://www.sedoparking.com/js/x.js"></script>',
    "<div>Related Searches: cheap flights ... Sponsored Listings</div>",
    "<p>This domain has been registered at Namecheap</p>",
  ])("spots %s", (h) => {
    expect(detectParked({ html: h })).not.toBeNull();
  });
  it("spots redirects to parking hosts", () => {
    expect(detectParked({ finalUrl: "https://www.hugedomains.com/domain_profile.cfm?d=x" })).toMatchObject({ signature: expect.stringContaining("hugedomains.com") });
    expect(detectParked({ redirectUrls: ["https://sedo.com/search/details/?domain=x"] })).not.toBeNull();
    expect(detectParked({ finalUrl: "https://porkbun.com/parked/x" })).not.toBeNull();
    expect(detectParked({ finalUrl: "https://porkbun.com/products/domains" })).toBeNull();
  });
  it("ignores ordinary pages, including ones that talk about domains", () => {
    expect(detectParked({ html: "<p>How to buy a domain name for your blog</p>", finalUrl: "https://blog.example/post" })).toBeNull();
    expect(detectParked({})).toBeNull();
    expect(detectParked({ finalUrl: "not a url" })).toBeNull();
  });
});

describe("looksLikeNotFound", () => {
  it("reads titles and the opening text", () => {
    expect(looksLikeNotFound("404 - Page Not Found", "")).toBe(true);
    expect(looksLikeNotFound("Oops!", "")).toBe(true);
    expect(looksLikeNotFound("Example", "Page not found. Try search.")).toBe(true);
    expect(looksLikeNotFound("Understanding HTTP status codes", "Lots of text about servers")).toBe(false);
    expect(looksLikeNotFound("My blog", `${"intro ".repeat(40)} 404 errors explained`)).toBe(false);
  });
});

describe("redirectedToRoot", () => {
  it("flags deep links that land on the home page of the same site", () => {
    expect(redirectedToRoot("https://ex.com/docs/a", "https://www.ex.com/")).toBe(true);
    expect(redirectedToRoot("https://ex.com/?p=12", "https://ex.com/")).toBe(true);
    expect(redirectedToRoot("https://ex.com/", "https://ex.com/")).toBe(false);
    expect(redirectedToRoot("https://ex.com/a", "https://other.com/")).toBe(false);
    expect(redirectedToRoot("https://ex.com/a", "https://ex.com/b")).toBe(false);
    expect(redirectedToRoot("https://ex.com/a", undefined)).toBe(false);
    expect(redirectedToRoot("nope", "https://ex.com/")).toBe(false);
  });
});

describe("parseHtml", () => {
  it("extracts title, text (skipping scripts/styles) and absolute links", () => {
    const info = parseHtml(
      `<html><head><title> Hello &amp; welcome </title><style>.x{}</style></head><body><script>var a=1</script><p>Visible <b>text</b></p><a href="/rel">r</a><a href="https://abs.example/x">a</a><a href="mailto:a@b.c">m</a></body></html>`,
      "https://site.example/dir/page",
    );
    expect(info.title).toBe("Hello & welcome");
    expect(info.text).toBe("Visible text r a m");
    expect(info.links).toEqual(["https://site.example/rel", "https://abs.example/x", "mailto:a@b.c"]);
  });
  it("honours <base href> and meta refresh", () => {
    const info = parseHtml(`<base href="https://cdn.example/root/"><meta http-equiv="refresh" content="0; url=https://next.example/"><a href="x">x</a>`, "https://site.example/");
    expect(info.links).toEqual(["https://cdn.example/root/x"]);
    expect(info.metaRefresh).toBe("https://next.example/");
  });
  it("keeps raw hrefs without a base", () => {
    expect(parseHtml(`<a href="/x">x</a>`).links).toEqual(["/x"]);
  });
});

describe("similarity", () => {
  it("cosine basics", () => {
    expect(cosineSimilarity("alpha beta gamma", "alpha beta gamma")).toBeCloseTo(1);
    expect(cosineSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
    expect(cosineSimilarity("", "")).toBe(1);
    expect(cosineSimilarity("", "words here")).toBe(0);
    expect(tokenize("Hi there, World! a b 42x")).toEqual(["there", "world", "42x"]);
  });
  it("property: symmetric, bounded, identity", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const s = cosineSimilarity(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(Math.abs(s - cosineSimilarity(b, a))).toBeLessThan(1e-9);
        expect(cosineSimilarity(a, a)).toBeCloseTo(1);
      }),
    );
  });
  it("lengthRatio", () => {
    expect(lengthRatio(0, 0)).toBe(1);
    expect(lengthRatio(50, 100)).toBe(0.5);
  });
});
