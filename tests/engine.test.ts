import { beforeEach, describe, expect, it } from "vitest";
import { __clearArchiveCaches } from "@/lib/archive/wayback";
import { healthScore, runScan, summarize } from "@/lib/scan/engine";
import { collectMarkdown, collectSite, parseSitemap } from "@/lib/scan/sources";
import type { LinkResult, ScanEvent, ScanInput } from "@/lib/scan/types";
import { html, lorem, mockResolver, mockTransport, redirect } from "./helpers";

const ARTICLE = lorem("article", 200);
const NOTFOUND_SHELL = lorem("shell", 150);
const BOOTSTRAP = { services: [[["com", "example"], ["https://rdap.test/"]]] };

function world() {
  const resolver = mockResolver({ "gone.example": null, "internal.example": ["10.1.2.3"] });
  const transport = mockTransport({
    "https://live.example/post": html(`<p>${ARTICLE}</p>`, "Post"),
    "https://dead.example/old": 404,
    "https://soft.example/missing-page": html(`<p>${NOTFOUND_SHELL}</p>`, "Soft"),
    "https://soft.example/*": html(`<p>${NOTFOUND_SHELL}</p>`, "Soft"),
    "https://parked.example/": html("<h1>This domain is for sale</h1>", "parked.example"),
    "https://drift.example/article": html(`<p>${lorem("brandnew", 200)}</p>`, "New"),
    "https://moved.example/deep/link": redirect("https://moved.example/"),
    "https://moved.example/": html(`<p>${lorem("home", 100)}</p>`, "Home"),
    "https://redir.example/x": redirect("http://internal.example/secret"),
    "https://data.iana.org/rdap/dns.json": Response.json(BOOTSTRAP),
    "https://rdap.test/domain/*": Response.json({ events: [{ eventAction: "registration", eventDate: "2000-01-01T00:00:00Z" }] }),
    "https://web.archive.org/cdx/search/cdx*": (u) => {
      const url = u.searchParams.get("url")!;
      return Response.json([["timestamp", "statuscode", "original"], ["20150301000000", "200", url]]);
    },
    "https://web.archive.org/web/20150301000000id_/https://drift.example/article": html(`<p>${lorem("original", 200)}</p>`),
    "https://web.archive.org/web/20150301000000id_/https://live.example/post": html(`<p>${ARTICLE}</p>`),
  });
  return { resolver, transport };
}

async function scan(input: ScanInput) {
  const events: ScanEvent[] = [];
  for await (const e of runScan(input, { deps: world(), budgetMs: 20_000 })) events.push(e);
  const results = new Map<string, LinkResult>();
  for (const e of events) if (e.type === "result") results.set(e.result.url, e.result);
  return { events, results };
}

describe("runScan end-to-end (network mocked)", () => {
  beforeEach(() => __clearArchiveCaches());

  it("streams status/meta, one result per unique link, then done", async () => {
    const md = `- [a](https://live.example/post)\n- [a again](https://live.example/post#frag)\n- [b](https://dead.example/old)\n- [c](https://gone.example/page)\n- [d](http://127.0.0.1/admin)\n- [e](https://soft.example/missing-page)\n- [f](https://parked.example/)\n- [g](https://drift.example/article)\n- [h](https://moved.example/deep/link)\n- [i](https://redir.example/x)\n`;
    const { events, results } = await scan({ kind: "markdown", text: md, citeDate: "2015-06-01" });
    expect(events[0].type).toBe("meta");
    expect(events.at(-1)!.type).toBe("done");
    const meta = events[0] as Extract<ScanEvent, { type: "meta" }>;
    expect(meta.total).toBe(9);
    expect(meta.docs[0].path).toBe("pasted.md");

    expect(results.get("https://live.example/post")!.cls).toBe("living");
    expect(results.get("https://live.example/post")!.drift).toBeCloseTo(1);
    expect(results.get("https://live.example/post")!.occurrences).toHaveLength(2);
    const dead = results.get("https://dead.example/old")!;
    expect(dead).toMatchObject({ cls: "tombstone", status: 404 });
    expect(dead.snapshot).toMatchObject({ timestamp: "20150301000000", beforeCite: true });
    expect(results.get("https://gone.example/page")!.cls).toBe("tombstone");
    expect(results.get("http://127.0.0.1/admin")!.cls).toBe("sealed");
    expect(results.get("http://127.0.0.1/admin")!.snapshot).toBeUndefined();
    expect(results.get("https://soft.example/missing-page")!.cls).toBe("ghost");
    expect(results.get("https://parked.example/")!.cls).toBe("zombie");
    const drift = results.get("https://drift.example/article")!;
    expect(drift.cls).toBe("drifted");
    expect(drift.drift).toBeLessThan(0.35);
    expect(results.get("https://moved.example/deep/link")!.cls).toBe("ghost");
    const redir = results.get("https://redir.example/x")!;
    expect(redir.cls).toBe("sealed");
    expect(redir.redirects).toHaveLength(1);

    const done = events.at(-1) as Extract<ScanEvent, { type: "done" }>;
    expect(done.summary.total).toBe(9);
    expect(done.summary.sealed).toBe(2);
  });

  it("reports a collection error as an error event", async () => {
    const { events } = await scan({ kind: "github", repo: "not a repo at all" });
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("GitHub repo") }]);
  });

  it("marks links unfinished at the time budget as restless", async () => {
    const slow = mockTransport({
      "https://slow.example/*": (_u, init) => new Promise<Response>((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    });
    const events: ScanEvent[] = [];
    for await (const e of runScan({ kind: "markdown", text: "https://slow.example/a" }, { deps: { transport: slow, resolver: mockResolver() }, budgetMs: 100 })) events.push(e);
    const r = events.find((e) => e.type === "result") as Extract<ScanEvent, { type: "result" }>;
    expect(r.result.cls).toBe("restless");
    expect(r.result.reasons[0]).toMatch(/budget/);
  });

  it("scans a GitHub repo with git-history cite dates", async () => {
    const { resolver } = world();
    const base = world().transport;
    const transport = mockTransport({
      "https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1": Response.json({ tree: [{ path: "README.md", type: "blob" }], truncated: false }, { headers: { "x-ratelimit-remaining": "50" } }),
      "https://api.github.com/repos/o/r/commits*": Response.json([
        { sha: "new", commit: { author: { date: "2021-01-01T00:00:00Z" } } },
        { sha: "old", commit: { author: { date: "2015-06-01T00:00:00Z" } } },
      ]),
      "https://raw.githubusercontent.com/o/r/HEAD/README.md": new Response("[x](https://dead.example/old) [y](https://live.example/post)"),
      "https://raw.githubusercontent.com/o/r/new/README.md": new Response("[x](https://dead.example/old) [y](https://live.example/post)"),
      "https://raw.githubusercontent.com/o/r/old/README.md": new Response("[x](https://dead.example/old)"),
      "*": (u, init) => base(u.href, init),
    });
    const events: ScanEvent[] = [];
    for await (const e of runScan({ kind: "github", repo: "o/r" }, { deps: { transport, resolver }, budgetMs: 20_000 })) events.push(e);
    expect(events.filter((e) => e.type === "status").length).toBeGreaterThan(0);
    const res = new Map(events.filter((e): e is Extract<ScanEvent, { type: "result" }> => e.type === "result").map((e) => [e.result.url, e.result]));
    expect(res.get("https://dead.example/old")).toMatchObject({ cls: "tombstone", citeDate: "2015-06-01T00:00:00.000Z", citeSource: "git" });
    expect(res.get("https://live.example/post")).toMatchObject({ citeDate: "2021-01-01T00:00:00.000Z", citeSource: "git" });
  });
});

describe("sources", () => {
  it("collectMarkdown de-duplicates and honours the cap", () => {
    const text = Array.from({ length: 320 }, (_, i) => `https://h.example/${i}`).join("\n") + "\nhttps://h.example/0#x";
    const c = collectMarkdown(text, "2015-01-01");
    expect(c.found).toBe(320);
    expect(c.targets).toHaveLength(300);
    expect(c.capped).toBe(true);
    expect(c.warnings[0]).toMatch(/first 300/);
    expect(c.targets[0]).toMatchObject({ citeSource: "user", citeDate: "2015-01-01T00:00:00.000Z" });
    expect(collectMarkdown("https://a.example", "2999-01-01").targets[0].citeDate).toBeUndefined();
  });
  it("parseSitemap handles urlsets and indexes", () => {
    expect(parseSitemap("<urlset><url><loc> https://a.example/1 </loc></url><url><loc>https://a.example/2?a=1&amp;b=2</loc></url></urlset>").pages).toEqual(["https://a.example/1", "https://a.example/2?a=1&b=2"]);
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>")).toEqual({ pages: [], sitemaps: ["https://a.example/s1.xml"] });
  });
  it("collectSite reads a page's links and optional sitemap pages", async () => {
    const transport = mockTransport({
      "https://site.example/": html(`<a href="/about">About</a><a href="https://ext.example/x">x</a><a href="mailto:a@b.c">m</a>`),
      "https://site.example/sitemap.xml": new Response("<sitemapindex><sitemap><loc>https://site.example/s1.xml</loc></sitemap></sitemapindex>"),
      "https://site.example/s1.xml": new Response("<urlset><url><loc>https://site.example/blog</loc></url></urlset>"),
      "https://site.example/blog": html(`<a href="https://ext.example/x">again</a><a href="https://ext.example/y">y</a>`),
    });
    const c = await collectSite("site.example", { sitemap: true }, { transport, resolver: mockResolver() });
    expect(c.targets.map((t) => t.url).sort()).toEqual(["https://ext.example/x", "https://ext.example/y", "https://site.example/about"]);
    expect(c.targets.find((t) => t.url === "https://ext.example/x")!.occurrences).toHaveLength(2);
    expect(c.source).toBe("site.example");
  });
  it("collectSite refuses internal targets and explains empty pages", async () => {
    await expect(collectSite("http://127.0.0.1/", {}, { transport: mockTransport({}), resolver: mockResolver() })).rejects.toThrow(/No links|blocked/);
    const empty = mockTransport({ "https://empty.example/": html("<p>no links</p>") });
    await expect(collectSite("https://empty.example/", {}, { transport: empty, resolver: mockResolver() })).rejects.toThrow(/No links/);
  });
});

describe("scoring", () => {
  it("health ignores restless/sealed and half-counts drifted", () => {
    expect(healthScore({ living: 2, drifted: 2, tombstone: 0, ghost: 0, zombie: 0, restless: 5, sealed: 5 })).toBe(75);
    expect(healthScore({ living: 0, drifted: 0, tombstone: 0, ghost: 0, zombie: 0, restless: 5, sealed: 0 })).toBe(100);
    const s = summarize([{ cls: "tombstone" } as LinkResult, { cls: "living" } as LinkResult]);
    expect(s).toMatchObject({ total: 2, tombstone: 1, living: 1, health: 50 });
  });
});
