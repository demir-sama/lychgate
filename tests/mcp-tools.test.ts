import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { __clearArchiveCaches } from "@/lib/archive/wayback";
import { THRESHOLDS } from "@/lib/classify/classify";
import { classifyUrlTool, findSnapshotTool, checkDriftTool, scanLinksTool, suggestReplacementTool, ClassifyUrlInput, FindSnapshotInput, CheckDriftInput, SuggestReplacementInput } from "../packages/lychgate-mcp/src/tools";
import { html, lorem, mockResolver, mockTransport, redirect } from "./helpers";

const cdx = (rows: string[][]) =>
  new Response(JSON.stringify([["timestamp", "statuscode", "original"], ...rows]), { headers: { "content-type": "application/json" } });

const json = (res: { content: Array<{ type: string; text: string }> }) => JSON.parse(res.content[1].text);

beforeEach(() => __clearArchiveCaches());

describe("mcp tools: classify_url (R2.2, R2.5, R2.6)", () => {
  it("returns a text block first and a JSON block second", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ "https://a.example/ok": html("<p>hello world</p>", "Hello") }) };
    const res = await classifyUrlTool({ url: "https://a.example/ok" }, deps);
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(2);
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toMatch(/living/i);
    const d = json(res);
    expect(d).toMatchObject({ url: "https://a.example/ok", cls: "living", status: 200 });
    expect(d).toHaveProperty("confidence");
    expect(d.reasons).toBeInstanceOf(Array);
  });

  it("reports a dead link as tombstone", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ "https://a.example/gone": 404 }) };
    const res = await classifyUrlTool({ url: "https://a.example/gone" }, deps);
    expect(json(res).cls).toBe("tombstone");
  });

  it("seals private targets without any fetch (R3.1)", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const deps = { resolver: mockResolver(), transport: mockTransport({}, calls) };
    const res = await classifyUrlTool({ url: "http://169.254.169.254/latest/meta-data" }, deps);
    expect(json(res).cls).toBe("sealed");
    expect(calls).toHaveLength(0);
  });

  it("returns a readable error result for bad input instead of throwing", async () => {
    for (const bad of [{}, { url: "" }, { url: "not a url" }, { url: "ftp://a.example/x" }, { url: "https://a.example/", citeDate: "yesterday" }, { url: 5 }]) {
      const res = await classifyUrlTool(bad as unknown, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text.length).toBeGreaterThan(5);
    }
  });

  it("schema accepts url with optional citeDate", () => {
    expect(ClassifyUrlInput.safeParse({ url: "https://a.example/", citeDate: "2019-05-01" }).success).toBe(true);
    expect(ClassifyUrlInput.safeParse({ url: "https://a.example/", citeDate: "05/01/2019" }).success).toBe(false);
  });
});

describe("mcp tools: find_snapshot (R2.3, R2.5, R2.6)", () => {
  const cdxUrl = "https://web.archive.org/cdx/search/cdx*";

  it("returns the latest 200 capture at or before the date", async () => {
    const deps = {
      resolver: mockResolver(),
      transport: mockTransport({ [cdxUrl]: cdx([["20150601120000", "200", "https://a.example/p"], ["20150701000000", "404", "https://a.example/p"]]) }),
    };
    const res = await findSnapshotTool({ url: "https://a.example/p", before: "2015-08-01" }, deps);
    expect(res.isError).toBeUndefined();
    const d = json(res);
    expect(d.found).toBe(true);
    expect(d.snapshot.timestamp).toBe("20150601120000");
    expect(d.snapshot.url).toContain("web.archive.org/web/20150601120000");
    expect(res.content[0].text).toContain("2015");
  });

  it("says plainly when no snapshot exists", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ [cdxUrl]: cdx([]), "https://archive.org/wayback/available*": new Response("{}", { headers: { "content-type": "application/json" } }) }) };
    const res = await findSnapshotTool({ url: "https://a.example/none", before: "2001-01-01" }, deps);
    expect(res.isError).toBeUndefined();
    expect(json(res).found).toBe(false);
    expect(res.content[0].text).toMatch(/no snapshot/i);
  });

  it("rejects bad input as an error result", async () => {
    for (const bad of [{}, { url: "nope" }, { url: "https://a.example/", before: "2015" }]) {
      const res = await findSnapshotTool(bad as unknown, {});
      expect(res.isError).toBe(true);
    }
    expect(FindSnapshotInput.safeParse({ url: "https://a.example/" }).success).toBe(true);
  });
});

describe("mcp tools: check_drift (R2.4, R2.5, R2.6)", () => {
  const cdxUrl = "https://web.archive.org/cdx/search/cdx*";
  const snapRow = [["20150601120000", "200", "https://a.example/p"]];
  const oldText = lorem("alpha", 150);
  const args = { url: "https://a.example/p", citeDate: "2015-08-01" };

  it("reports high similarity and no drift when the page is unchanged", async () => {
    const deps = {
      resolver: mockResolver(),
      transport: mockTransport({
        "https://a.example/p": html(`<p>${oldText}</p>`),
        [cdxUrl]: cdx(snapRow),
        "https://web.archive.org/web/20150601120000id_/https://a.example/p": html(`<p>${oldText}</p>`),
      }),
    };
    const res = await checkDriftTool(args, deps);
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(2);
    const d = json(res);
    expect(d.similarity).toBeGreaterThan(0.95);
    expect(d.drifted).toBe(false);
    expect(d.threshold).toBe(THRESHOLDS.drift);
    expect(d.snapshot.timestamp).toBe("20150601120000");
  });

  it("flags drift when the live page says something else", async () => {
    const deps = {
      resolver: mockResolver(),
      transport: mockTransport({
        "https://a.example/p": html(`<p>${lorem("zulu", 150).replace(/\d+word\d+/g, (m) => "q" + m.length + "x")}</p>`),
        [cdxUrl]: cdx(snapRow),
        "https://web.archive.org/web/20150601120000id_/https://a.example/p": html(`<p>${oldText}</p>`),
      }),
    };
    const d = json(await checkDriftTool(args, deps));
    expect(d.drifted).toBe(true);
    expect(d.similarity).toBeLessThan(THRESHOLDS.drift);
  });

  it("says plainly when there is no snapshot to compare", async () => {
    const deps = {
      resolver: mockResolver(),
      transport: mockTransport({
        "https://a.example/p": html(`<p>${oldText}</p>`),
        [cdxUrl]: cdx([]),
        "https://archive.org/wayback/available*": new Response("{}", { headers: { "content-type": "application/json" } }),
      }),
    };
    const res = await checkDriftTool(args, deps);
    expect(res.isError).toBeUndefined();
    const d = json(res);
    expect(d.comparable).toBe(false);
    expect(res.content[0].text).toMatch(/no snapshot/i);
  });

  it("says plainly when the live page cannot be read", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ "https://a.example/p": 404 }) };
    const d = json(await checkDriftTool(args, deps));
    expect(d.comparable).toBe(false);
    expect(d.status).toBe(404);
  });

  it("makes no fetch for a private target (R3.1)", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const deps = { resolver: mockResolver(), transport: mockTransport({}, calls) };
    const d = json(await checkDriftTool({ url: "http://169.254.169.254/x", citeDate: "2015-08-01" }, deps));
    expect(d.comparable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rejects bad input as an error result; citeDate is required", async () => {
    for (const bad of [{}, { url: "nope", citeDate: "2015-08-01" }, { url: "https://a.example/p" }, { url: "https://a.example/p", citeDate: "2015" }]) {
      expect((await checkDriftTool(bad as unknown, {})).isError).toBe(true);
    }
    expect(CheckDriftInput.safeParse(args).success).toBe(true);
  });
});

describe("mcp tools: scan_links (R2.1, R2.5, R2.6, R3.4)", () => {
  const md = [
    "- [ok](https://a.example/ok)",
    "- [gone](https://a.example/gone)",
    "- [nope](http://169.254.169.254/x)",
    "- [ok2](https://a.example/ok2)",
  ].join("\n");
  const mkDeps = () => ({
    resolver: mockResolver(),
    transport: mockTransport({ "https://a.example/ok": html("<p>hello</p>"), "https://a.example/ok2": html("<p>hi</p>") }),
  });

  it("scans markdown: summary text first, non-living results worst first, living left out", async () => {
    const res = await scanLinksTool({ markdown: md }, mkDeps());
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(2);
    expect(res.content[0].text).toMatch(/4 links/);
    const d = json(res);
    expect(d.summary.total).toBe(4);
    expect(d.summary.living).toBe(2);
    expect(d.results.map((r: { cls: string }) => r.cls)).toEqual(["tombstone", "sealed"]);
    expect(d.results[0].occurrences[0]).toMatchObject({ line: 2 });
    expect(d.capped).toBe(false);
    expect(d.timedOut).toBe(false);
  });

  it("reports the 300-link cap", async () => {
    const many = Array.from({ length: 305 }, (_, i) => `https://a.example/p${i}`).join("\n");
    const res = await scanLinksTool({ markdown: many }, mkDeps());
    const d = json(res);
    expect(d.capped).toBe(true);
    expect(d.found).toBe(305);
    expect(d.summary.total).toBe(300);
    expect(res.content[0].text).toMatch(/first 300/);
  });

  it("reports when the time budget ran out", async () => {
    const slow = { resolver: mockResolver(), transport: mockTransport({ "https://a.example/*": (_u, init) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted")))) }) };
    const res = await scanLinksTool({ markdown: "https://a.example/slow" }, slow, { budgetMs: 50 });
    const d = json(res);
    expect(d.timedOut).toBe(true);
    expect(res.content[0].text).toMatch(/time budget/i);
  });

  it("requires exactly one of path, markdown, url, repo", async () => {
    for (const bad of [{}, { markdown: md, url: "https://a.example/" }, { markdown: "" }, { repo: "x" , url: "https://a.example/" }, { markdown: md, citeDate: "soon" }]) {
      const res = await scanLinksTool(bad as unknown, mkDeps());
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/invalid input/i);
    }
  });

  it("scans a url (page links) and a repo through the same engine", async () => {
    const deps = {
      resolver: mockResolver(),
      transport: mockTransport({
        "https://a.example/page": html('<a href="https://a.example/gone">x</a>'),
      }),
    };
    const res = await scanLinksTool({ url: "https://a.example/page" }, deps);
    expect(res.isError).toBeUndefined();
    expect(json(res).results.map((r: { url: string }) => r.url)).toContain("https://a.example/gone");
    const bad = await scanLinksTool({ repo: "not a repo!!" }, deps);
    expect(bad.isError).toBe(true);
  });

  it("scans a workspace file and labels results with the file path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lychgate-"));
    writeFileSync(join(dir, "doc.md"), "intro\n[gone](https://a.example/gone)\n");
    const res = await scanLinksTool({ path: "doc.md" }, mkDeps(), { cwd: dir });
    expect(res.isError).toBeUndefined();
    expect(json(res).results[0].occurrences[0]).toEqual({ doc: "doc.md", line: 2 });
    const outside = await scanLinksTool({ path: "../etc/passwd" }, mkDeps(), { cwd: dir });
    expect(outside.isError).toBe(true);
    expect(outside.content[0].text).toMatch(/outside/i);
  });
});

describe("mcp tools: suggest_replacement (R4.13, R2.5, R2.6)", () => {
  it("returns a text block, then JSON with the replacement", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({ "https://a.example/old": () => redirect("/new-home/page", 301), "https://a.example/new-home/page": html(lorem("t"), "New page") }) };
    const res = await suggestReplacementTool({ url: "https://a.example/old" }, deps);
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(2);
    expect(res.content[0].text).toContain("https://a.example/new-home/page");
    expect(json(res)).toMatchObject({ url: "https://a.example/old", found: true, replacement: { url: "https://a.example/new-home/page", reason: "redirect" } });
  });

  it("says plainly when there is nothing to suggest", async () => {
    const deps = { resolver: mockResolver(), transport: mockTransport({}) };
    const res = await suggestReplacementTool({ url: "https://a.example/gone" }, deps);
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toMatch(/no replacement/i);
    expect(json(res)).toMatchObject({ found: false, replacement: null });
  });

  it("makes no request for a Sealed target", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const deps = { resolver: mockResolver(), transport: mockTransport({}, calls) };
    const res = await suggestReplacementTool({ url: "http://169.254.169.254/latest/meta-data" }, deps);
    expect(json(res).found).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns a readable error result for bad input", async () => {
    for (const bad of [{}, { url: "" }, { url: "ftp://a.example/x" }, { url: 5 }]) {
      const res = await suggestReplacementTool(bad as unknown, {});
      expect(res.isError).toBe(true);
    }
    expect(SuggestReplacementInput.safeParse({ url: "https://a.example/" }).success).toBe(true);
  });
});
