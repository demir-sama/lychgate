import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { __clearArchiveCaches } from "@/lib/archive/wayback";
import { ScanInputSchema } from "@/lib/scan/input";
import { collectDocs } from "@/lib/scan/sources";
import { run } from "../action/src/run";
import { html, lorem, mockResolver, mockTransport } from "./helpers";

function workspace(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "lg-ws-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  return root;
}
function hashTree(root: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  walk(root);
  return h.digest("hex");
}
const world = () => ({
  resolver: mockResolver(),
  transport: mockTransport({
    "https://live.example/post": html(`<p>${lorem("a", 200)}</p>`, "Post"),
    "https://dead.example/old": 404,
    "https://slow.example/": 503,
  }),
});
const hang = () => ({
  resolver: mockResolver(),
  transport: mockTransport({
    "https://*": (_u, init) => new Promise<Response>((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  }),
});
const MD = "- [live](https://live.example/post)\n- [dead](https://dead.example/old)\n";
const env = (root: string, more: Record<string, string> = {}) => ({ GITHUB_WORKSPACE: root, "INPUT_CITE-DATES": "none", ...more });

describe("run (R5.6, R5.9, R5.10)", () => {
  beforeEach(() => __clearArchiveCaches());

  it("a Tombstone with the default fail-on exits 1 and writes outputs", async () => {
    const root = workspace({ "README.md": MD });
    const r = await run(env(root), { deps: world(), budgetMs: 20_000 });
    expect(r.exitCode).toBe(1);
    expect(r.outputs.dead).toBe(1);
    expect(r.outputs.health).toBe(50);
    expect(r.summary).toContain("README.md:2");
    expect(r.summary).toContain("dead.example");
  });
  it("a Restless link does not fail by default, but fails when restless is in fail-on", async () => {
    const root = workspace({ "README.md": "- [s](https://slow.example/)\n" });
    expect((await run(env(root), { deps: hang(), budgetMs: 100 })).exitCode).toBe(0);
    __clearArchiveCaches();
    expect((await run(env(root, { "INPUT_FAIL-ON": "restless" }), { deps: hang(), budgetMs: 100 })).exitCode).toBe(1);
  });
  it("an empty fail-on never fails", async () => {
    const root = workspace({ "README.md": MD });
    expect((await run(env(root, { "INPUT_FAIL-ON": "" }), { deps: world(), budgetMs: 20_000 })).exitCode).toBe(0);
  });
  it("an invalid input exits 2 and names the input", async () => {
    const root = workspace({ "README.md": MD });
    const r = await run(env(root, { "INPUT_FAIL-ON": "living" }), { deps: world() });
    expect(r.exitCode).toBe(2);
    expect(r.stdout.join("\n")).toContain("fail-on");
  });
  it("a missing workspace exits 2", async () => {
    expect((await run(env("/definitely/not/here"), { deps: world() })).exitCode).toBe(2);
  });
  it("a workspace without Markdown is a clean pass with a note", async () => {
    const r = await run(env(workspace({ "a.txt": "x" })), { deps: world() });
    expect(r.exitCode).toBe(0);
    expect(r.summary).toMatch(/no markdown/i);
  });
  it("a budget that ran out makes links Restless and says so", async () => {
    const root = workspace({ "README.md": MD });
    const r = await run(env(root), { deps: hang(), budgetMs: 100 });
    expect(r.exitCode).toBe(0);
    expect(r.summary).toMatch(/time budget ran out/i);
    expect(r.outputs.dead).toBe(0);
  });
  it("never writes to the workspace (hash unchanged)", async () => {
    const root = workspace({ "README.md": MD, "docs/a.md": "[x](http://169.254.169.254/)\n" });
    const before = hashTree(root);
    await run(env(root), { deps: world(), budgetMs: 20_000 });
    expect(hashTree(root)).toBe(before);
  });
  it("a link to a metadata address is Sealed, not fetched", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const transport = mockTransport({}, calls);
    const root = workspace({ "README.md": "[m](http://169.254.169.254/latest)\n" });
    const r = await run(env(root, { "INPUT_FAIL-ON": "sealed" }), { deps: { resolver: mockResolver(), transport }, budgetMs: 20_000 });
    expect(r.exitCode).toBe(1);
    expect(calls.some((c) => c.url.includes("169.254"))).toBe(false);
  });
  it("dates links from the local git history when cite-dates is git", async () => {
    const root = workspace({ "README.md": MD });
    const g = (a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...a], { cwd: root, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: "2018-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2018-01-01T00:00:00Z" } });
    g(["init", "-q"]);
    g(["add", "."]);
    g(["commit", "-q", "-m", "x"]);
    const r = await run({ GITHUB_WORKSPACE: root }, { deps: world(), budgetMs: 20_000 });
    expect(r.exitCode).toBe(1);
    expect(r.summary).not.toMatch(/fetch-depth/);
  });
});

describe("docs input (R5.6)", () => {
  it("collectDocs reads links per document with git cite dates and keeps the 300 cap", () => {
    const docs = [{ path: "a.md", content: "[x](https://x.example/)\n[y](https://y.example/)\n" }];
    const c = collectDocs(docs, { "a.md": { "https://x.example/": { date: "2019-03-04T00:00:00Z", exact: true } } }, "workspace");
    const x = c.targets.find((t) => t.url === "https://x.example/")!;
    expect(x).toMatchObject({ citeSource: "git", citeExact: true });
    expect(x.citeDate).toBe("2019-03-04T00:00:00.000Z");
    expect(x.occurrences).toEqual([{ doc: "a.md", line: 1 }]);
    expect(c.targets.find((t) => t.url === "https://y.example/")!.citeSource).toBe("none");
    const big = [{ path: "b.md", content: Array.from({ length: 350 }, (_, i) => `[l](https://e.example/${i})`).join("\n") }];
    const capped = collectDocs(big, {}, "workspace");
    expect(capped.targets).toHaveLength(300);
    expect(capped.capped).toBe(true);
  });
  it("/api/scan's schema refuses kind: docs", () => {
    const r = ScanInputSchema.safeParse({ kind: "docs", docs: [{ path: "a.md", content: "x" }] });
    expect(r.success).toBe(false);
  });
});
