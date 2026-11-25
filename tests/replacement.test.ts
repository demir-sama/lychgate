import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LINK_CLASSES, type LinkClass } from "@/lib/classify/classify";
import { GitHubClient } from "@/lib/github/repo";
import {
  MAX_SITEMAP_URLS,
  mapGithubUrl,
  parseSitemap,
  rankCandidates,
  REPLACEMENT_BUDGET_MS,
  slugScore,
  slugTokens,
  suggestReplacement,
  type VerifyResult,
} from "@/lib/patch/replacement";
import { html, lorem, mockResolver, mockTransport, redirect } from "./helpers";

type Call = { url: string; method: string };
const xml = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/xml" } });
const urlset = (urls: string[]) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
const living = async (): Promise<VerifyResult> => ({ cls: "living", title: "Some page" });
const verifyMap = (m: Record<string, LinkClass>, seen: string[] = []) => async (u: string): Promise<VerifyResult> => {
  seen.push(u);
  return { cls: m[u] ?? "tombstone" };
};
const json = (o: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "x-ratelimit-remaining": "50", ...headers } });

describe("slug ranking helpers (R4.4, R4.8)", () => {
  it("tokenises the path: lower case, no extension, split on punctuation", () => {
    expect(slugTokens("https://a.example/Blog/2019/My_First-Post.html?x=1")).toEqual(["blog", "2019", "my", "first", "post"]);
    expect(slugTokens("https://a.example/")).toEqual([]);
  });

  it("scores the same slug under another section higher than an unrelated page", () => {
    const t = "https://a.example/blog/2019/getting-started-guide";
    expect(slugScore(t, "https://a.example/docs/getting-started-guide")).toBeGreaterThan(0.7);
    expect(slugScore(t, "https://a.example/about/team")).toBeLessThan(0.2);
    expect(slugScore(t, "https://a.example/")).toBe(0);
  });

  it("drops the target, roots, other domains and non-http URLs, and sorts by score then URL", () => {
    const t = "https://a.example/docs/old-page";
    const ranked = rankCandidates(t, [
      t,
      "https://a.example/",
      "https://other.org/docs/old-page",
      "ftp://a.example/docs/old-page",
      "not a url",
      "https://www.a.example/guide/old-page",
      "https://a.example/guide/old-page",
      "https://a.example/zzz/old-page",
      "https://a.example/totally/different",
    ]);
    expect(ranked.map((r) => r.url)).toEqual(["https://a.example/guide/old-page", "https://a.example/zzz/old-page", "https://www.a.example/guide/old-page"]);
    expect(ranked.every((r) => r.score >= 0.4 && r.score <= 1)).toBe(true);
  });

  it("does not treat two github.io project sites as one site", () => {
    expect(rankCandidates("https://alice.github.io/docs/x-y", ["https://bob.github.io/docs/x-y"])).toEqual([]);
  });

  it("R4.8: the order of the input never changes the ranking", () => {
    const seg = fc.stringMatching(/^[a-z0-9]{1,6}(-[a-z0-9]{1,6}){0,2}$/);
    const urlArb = fc.tuple(fc.constantFrom("a.example", "www.a.example", "b.example"), fc.array(seg, { minLength: 1, maxLength: 3 })).map(([h, p]) => `https://${h}/${p.join("/")}`);
    fc.assert(
      fc.property(
        seg,
        fc.array(urlArb, { maxLength: 12 }).chain((arr) => fc.tuple(fc.constant(arr), fc.shuffledSubarray(arr, { minLength: arr.length, maxLength: arr.length }))),
        (slug, [arr, shuffled]) => {
          const t = `https://a.example/old/${slug}`;
          expect(rankCandidates(t, shuffled)).toEqual(rankCandidates(t, arr));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("parseSitemap (R4.5)", () => {
  it("reads a urlset, decoding entities and CDATA", () => {
    const r = parseSitemap(`<urlset><url><loc>https://a.example/x?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://a.example/y]]></loc></url></urlset>`);
    expect(r).toEqual({ kind: "urlset", locs: ["https://a.example/x?a=1&b=2", "https://a.example/y"] });
  });
  it("reads a sitemap index", () => {
    const r = parseSitemap(`<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>`);
    expect(r).toEqual({ kind: "index", locs: ["https://a.example/s1.xml"] });
  });
  it("stops at the URL cap", () => {
    const r = parseSitemap(urlset(Array.from({ length: 50 }, (_, i) => `https://a.example/${i}`)), 10);
    expect(r.locs).toHaveLength(10);
    expect(MAX_SITEMAP_URLS).toBe(5000);
  });
  it("returns nothing for garbage and never throws", () => {
    expect(parseSitemap("<<<>>> not xml at all").locs).toEqual([]);
    expect(parseSitemap("").locs).toEqual([]);
    expect(parseSitemap(`<urlset><url><loc>https://a.example/cut`).kind).toBe("urlset");
  });
});

describe("mapGithubUrl (R4.1)", () => {
  it("swaps owner/repo and keeps the rest of the path and the query", () => {
    expect(mapGithubUrl("https://github.com/old/repo/blob/main/x.md", "new/repo2")).toBe("https://github.com/new/repo2/blob/main/x.md");
    expect(mapGithubUrl("https://github.com/old/repo/issues/12?q=1", "new/repo")).toBe("https://github.com/new/repo/issues/12?q=1");
    expect(mapGithubUrl("https://github.com/old/repo", "new/repo")).toBe("https://github.com/new/repo");
  });
  it("is null when the name only differs by case, or the URL is not a repo URL", () => {
    expect(mapGithubUrl("https://github.com/Old/Repo/tree/main", "old/repo")).toBeNull();
    expect(mapGithubUrl("https://github.com/old", "new/repo")).toBeNull();
    expect(mapGithubUrl("https://gitlab.com/old/repo", "new/repo")).toBeNull();
    expect(mapGithubUrl("https://github.com/old/repo", "not-a-full-name")).toBeNull();
  });
  it("R4.1 property: owner/repo are replaced and everything after them is kept", () => {
    const name = fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/).filter((s) => !/^\.+$/.test(s));
    const seg = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
    fc.assert(
      fc.property(name, name, name, name, fc.array(seg, { maxLength: 4 }), (o, r, no, nr, rest) => {
        fc.pre(`${o}/${r}`.toLowerCase() !== `${no}/${nr}`.toLowerCase());
        const tail = rest.length ? `/${rest.join("/")}` : "";
        expect(mapGithubUrl(`https://github.com/${o}/${r}${tail}`, `${no}/${nr}`)).toBe(`https://github.com/${no}/${nr}${tail}`);
      }),
      { numRuns: 200 },
    );
  });
});

describe("suggestReplacement: GitHub renames (R4.1, R4.2, R4.10, R4.11)", () => {
  const apiRepo = "https://api.github.com/repos/old/repo";
  const renamed = (calls: Call[] = []) =>
    mockTransport(
      {
        [apiRepo]: () => redirect("https://api.github.com/repositories/42", 301),
        "https://api.github.com/repositories/42": () => json({ full_name: "new/repo" }),
      },
      calls,
    );

  it("follows the API's rename redirect through the guarded fetch and maps the path onto the new repo", async () => {
    const calls: Call[] = [];
    const deps = { resolver: mockResolver(), transport: renamed(calls) };
    const seen: string[] = [];
    const r = await suggestReplacement("https://github.com/old/repo/blob/main/x.md", {
      deps,
      github: new GitHubClient(deps, undefined),
      verify: async (u) => (seen.push(u), { cls: "living" }),
    });
    expect(r).toMatchObject({ url: "https://github.com/new/repo/blob/main/x.md", reason: "github-rename" });
    expect(r!.confidence).toBeGreaterThan(0.9);
    expect(seen).toEqual(["https://github.com/new/repo/blob/main/x.md"]);
    expect(calls.map((c) => c.url)).toEqual([apiRepo, "https://api.github.com/repositories/42"]);
  });

  it("does not suggest when the repo kept its name (case aside)", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ "https://api.github.com/repos/Old/Repo": () => json({ full_name: "old/repo" }) }) };
    const r = await suggestReplacement("https://github.com/Old/Repo/tree/main", { deps, github: new GitHubClient(deps, undefined), verify: living });
    expect(r).toBeNull();
  });

  it("does not call the API when the client cannot afford it, and moves on", async () => {
    const calls: Call[] = [];
    const deps = { resolver: mockResolver(), transport: renamed(calls) };
    const client = new GitHubClient(deps, undefined);
    client.remaining = 0;
    client.resetAt = Date.now() + 60_000;
    expect(client.canAfford()).toBe(false);
    const r = await suggestReplacement("https://github.com/old/repo", { deps, github: client, verify: living });
    expect(r).toBeNull();
    expect(calls.some((c) => c.url.startsWith("https://api.github.com"))).toBe(false);
  });

  it("treats a missing repo or a rate-limit error as no candidate, not a failure", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ [apiRepo]: 404 }) };
    expect(await suggestReplacement("https://github.com/old/repo", { deps, github: new GitHubClient(deps, undefined), verify: living })).toBeNull();
    const limited = { resolver: mockResolver(), transport: mockTransport({ [apiRepo]: () => new Response("{}", { status: 429, headers: { "x-ratelimit-remaining": "0" } }) }) };
    expect(await suggestReplacement("https://github.com/old/repo", { deps: limited, github: new GitHubClient(limited, undefined), verify: living })).toBeNull();
  });

  it("does not use the sitemap for github.com", async () => {
    const calls: Call[] = [];
    const deps = { resolver: mockResolver(), transport: mockTransport({}, calls) };
    await suggestReplacement("https://github.com/old/repo/issues/1", { deps, github: new GitHubClient(deps, undefined), verify: living });
    expect(calls.some((c) => c.url.endsWith("/sitemap.xml"))).toBe(false);
  });

  it("R4.1 property: the suggestion keeps the new owner/repo and the old remaining path", async () => {
    const name = fc.stringMatching(/^[A-Za-z0-9_-]{1,10}$/);
    const seg = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
    await fc.assert(
      fc.asyncProperty(name, name, name, name, fc.array(seg, { maxLength: 3 }), async (o, r, no, nr, rest) => {
        fc.pre(`${o}/${r}`.toLowerCase() !== `${no}/${nr}`.toLowerCase());
        const tail = rest.length ? `/${rest.join("/")}` : "";
        const github = { canAfford: () => true, repo: async () => ({ fullName: `${no}/${nr}` }) };
        const s = await suggestReplacement(`https://github.com/${o}/${r}${tail}`, { deps: { resolver: mockResolver() }, github, verify: living });
        expect(s).toMatchObject({ url: `https://github.com/${no}/${nr}${tail}`, reason: "github-rename" });
      }),
      { numRuns: 60 },
    );
  });
});

describe("suggestReplacement: redirects (R4.3)", () => {
  const base = () => ({ resolver: mockResolver() });

  it("proposes the final URL of a same-domain redirect chain", async () => {
    const deps = { ...base(), transport: mockTransport({ "https://a.example/old": () => redirect("/moved/new-page", 301), "https://a.example/moved/new-page": html(lorem("x"), "New") }) };
    const r = await suggestReplacement("https://a.example/old", { deps });
    expect(r).toMatchObject({ url: "https://a.example/moved/new-page", reason: "redirect" });
    expect(r!.confidence).toBeGreaterThan(0.8);
  });

  it("ignores a redirect to the site root, which is a soft-404", async () => {
    const deps = { ...base(), transport: mockTransport({ "https://a.example/old": () => redirect("/", 302), "https://a.example/": html("home", "Home") }) };
    expect(await suggestReplacement("https://a.example/old", { deps })).toBeNull();
  });

  it("ignores a redirect to another registrable domain", async () => {
    const deps = { ...base(), transport: mockTransport({ "https://a.example/old": () => redirect("https://other.org/new", 301), "https://other.org/new": html(lorem("y"), "Other") }) };
    expect(await suggestReplacement("https://a.example/old", { deps })).toBeNull();
  });

  it("does not suggest a redirect target that is itself dead", async () => {
    const deps = { ...base(), transport: mockTransport({ "https://a.example/old": () => redirect("/gone", 301), "https://a.example/gone": 404 }) };
    expect(await suggestReplacement("https://a.example/old", { deps })).toBeNull();
  });
});

describe("suggestReplacement: sitemap (R4.4, R4.5, R4.6)", () => {
  const target = "https://a.example/blog/2019/getting-started-guide";
  const resolver = mockResolver();

  it("finds the moved page by slug, verifies it, and labels it sitemap", async () => {
    const calls: Call[] = [];
    const sm = urlset(["https://a.example/about", "https://a.example/docs/getting-started-guide", "https://a.example/pricing"]);
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(sm) }, calls) };
    const r = await suggestReplacement(target, { deps, verify: living });
    expect(r).toMatchObject({ url: "https://a.example/docs/getting-started-guide", reason: "sitemap" });
    expect(r!.confidence).toBeGreaterThan(0.3);
    expect(r!.confidence).toBeLessThanOrEqual(0.85);
    expect(calls.filter((c) => c.url.endsWith("sitemap.xml"))).toHaveLength(1);
  });

  it("verifies at most three candidates, best first, and suggests only a Living one", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://a.example/s${i}/getting-started-guide`);
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset(urls)) }) };
    const seen: string[] = [];
    expect(await suggestReplacement(target, { deps, verify: verifyMap({}, seen) })).toBeNull();
    expect(seen).toEqual(urls.slice(0, 3));
    // the third-best is the only Living one: still found
    const seen2: string[] = [];
    const r = await suggestReplacement(target, { deps, verify: verifyMap({ [urls[2]]: "living" }, seen2) });
    expect(r?.url).toBe(urls[2]);
    expect(seen2).toHaveLength(3);
  });

  it("uses the title of the old page to choose between two Living candidates", async () => {
    const a = "https://a.example/x/getting-started-guide";
    const b = "https://a.example/y/getting-started-guide";
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset([a, b])) }) };
    const verify = async (u: string): Promise<VerifyResult> => ({ cls: "living", title: u === b ? "Getting started guide for beginners" : "Pricing and plans" });
    const r = await suggestReplacement(target, { deps, verify, refTitle: async () => "Getting started guide" });
    expect(r?.url).toBe(b);
  });

  it("follows a sitemap index one level: one child, never a grandchild", async () => {
    const calls: Call[] = [];
    const index = `<sitemapindex><sitemap><loc>https://a.example/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://a.example/sitemap-blog.xml</loc></sitemap></sitemapindex>`;
    const nested = `<sitemapindex><sitemap><loc>https://a.example/deeper.xml</loc></sitemap></sitemapindex>`;
    const deps = {
      resolver,
      transport: mockTransport(
        {
          "https://a.example/sitemap.xml": xml(index),
          "https://a.example/sitemap-blog.xml": xml(urlset(["https://a.example/guides/getting-started-guide"])),
          "https://a.example/sitemap-pages.xml": xml(nested),
        },
        calls,
      ),
    };
    const r = await suggestReplacement(target, { deps, verify: living });
    expect(r?.url).toBe("https://a.example/guides/getting-started-guide");
    const sitemapFetches = calls.filter((c) => /\.xml$/.test(c.url)).map((c) => c.url);
    expect(sitemapFetches).toEqual(["https://a.example/sitemap.xml", "https://a.example/sitemap-blog.xml"]);
  });

  it("does not follow an index into a child on another host", async () => {
    const calls: Call[] = [];
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(`<sitemapindex><sitemap><loc>https://evil.test/s.xml</loc></sitemap></sitemapindex>`) }, calls) };
    expect(await suggestReplacement(target, { deps, verify: living })).toBeNull();
    expect(calls.some((c) => c.url.includes("evil.test"))).toBe(false);
  });

  it("reads at most 5,000 URLs", async () => {
    const filler = Array.from({ length: 5200 }, (_, i) => `https://a.example/f/n${i}`);
    filler[100] = "https://a.example/guides/getting-started";
    filler[5100] = "https://a.example/docs/getting-started-guide"; // better, but past the cap
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset(filler)) }) };
    const r = await suggestReplacement(target, { deps, verify: living });
    expect(r?.url).toBe("https://a.example/guides/getting-started");
  });

  it("reads at most 512 KB of a sitemap", async () => {
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(" ".repeat(600 * 1024) + urlset(["https://a.example/docs/getting-started-guide"])) }) };
    expect(await suggestReplacement(target, { deps, verify: living })).toBeNull();
  });

  it("treats a missing, broken or non-200 sitemap as no candidate", async () => {
    for (const res of [xml("nope", 404), xml("<<<>>>"), new Response("", { status: 500 })]) {
      const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": res }) };
      expect(await suggestReplacement(target, { deps, verify: living })).toBeNull();
    }
  });

  it("R4.7: a candidate host that resolves to a private address is Sealed and never fetched", async () => {
    const calls: Call[] = [];
    const sm = urlset(["https://intranet.a.example/docs/getting-started-guide"]);
    const deps = { resolver: mockResolver({ "intranet.a.example": ["10.0.0.5"] }), transport: mockTransport({ "https://a.example/sitemap.xml": xml(sm) }, calls) };
    expect(await suggestReplacement(target, { deps })).toBeNull();
    expect(calls.some((c) => c.url.includes("intranet.a.example"))).toBe(false);
  });

  it("works end to end with the scanner's own verification (no injected verify)", async () => {
    const good = "https://a.example/docs/getting-started-guide";
    const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset([good])), [good]: html(lorem("guide"), "Getting started guide") }) };
    const r = await suggestReplacement(target, { deps });
    expect(r).toMatchObject({ url: good, reason: "sitemap" });
  });

  it("R4.7 property: whatever the sitemap lists, the answer is null or a Living URL it listed", async () => {
    const seg = fc.stringMatching(/^[a-z]{2,6}(-[a-z]{2,6}){0,2}$/);
    const urlArb = fc.tuple(seg, seg).map(([a, b]) => `https://a.example/${a}/${b}`);
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(urlArb, { maxLength: 15 }), fc.array(fc.constantFrom(...LINK_CLASSES), { minLength: 15, maxLength: 15 }), async (urls, classes) => {
        const table: Record<string, LinkClass> = Object.fromEntries(urls.map((u, i) => [u, classes[i]]));
        const deps = { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset(urls)) }) };
        const r = await suggestReplacement("https://a.example/blog/old-page", { deps, verify: verifyMap(table) });
        if (r) {
          expect(urls).toContain(r.url);
          expect(table[r.url]).toBe("living");
          expect(r.confidence).toBeGreaterThanOrEqual(0);
          expect(r.confidence).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("R4.8 property: shuffling the sitemap never changes the suggestion", async () => {
    const urls = ["old-page", "blog/old-page", "x/old-page-2", "y/old", "z/page", "docs/old-page-guide", "q/other-thing"].map((p) => `https://a.example/${p}`);
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(urls, { minLength: urls.length, maxLength: urls.length }), async (shuffled) => {
        const run = (list: string[]) => suggestReplacement("https://a.example/news/old-page", { deps: { resolver, transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset(list)) }) }, verify: living });
        expect(await run(shuffled)).toEqual(await run(urls));
      }),
      { numRuns: 40 },
    );
  });
});

describe("suggestReplacement: guard rails (R4.7, R4.10, R4.11)", () => {
  it("makes no request at all for a Sealed or unresolvable target", async () => {
    const calls: Call[] = [];
    const deps = { resolver: mockResolver({ "gone.example": null }), transport: mockTransport({}, calls) };
    expect(await suggestReplacement("http://169.254.169.254/latest/meta-data", { deps })).toBeNull();
    expect(await suggestReplacement("http://localhost/x", { deps })).toBeNull();
    expect(await suggestReplacement("https://gone.example/page", { deps })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null for input that is not an http(s) URL", async () => {
    expect(await suggestReplacement("ftp://a.example/x", {})).toBeNull();
    expect(await suggestReplacement("nonsense", {})).toBeNull();
  });

  it("returns null, not an error, when the signal is already aborted", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({}) };
    expect(await suggestReplacement("https://a.example/old", { deps, signal: AbortSignal.abort() })).toBeNull();
  });

  it("never suggests the target itself", async () => {
    const t = "https://a.example/docs/page";
    const deps = { resolver: mockResolver(), transport: mockTransport({ "https://a.example/sitemap.xml": xml(urlset([t])) }) };
    expect(await suggestReplacement(t, { deps, verify: living })).toBeNull();
  });

  it("has a 15 second budget", () => {
    expect(REPLACEMENT_BUDGET_MS).toBe(15_000);
  });
});
