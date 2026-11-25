import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const hook = path.join(root, "scripts/hooks/dogfood-links.mjs");
const fake = path.join(root, "tests/fixtures/fake-mcp.mjs");
const dist = path.join(root, "packages/lychgate-mcp/dist/index.js");

let dir: string;
const DOC = "# Notes\n\n[metadata](http://169.254.169.254/latest)\n";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lychgate-hook-"));
  writeFileSync(path.join(dir, "doc.md"), DOC);
  writeFileSync(path.join(dir, "notes.txt"), DOC);
  writeFileSync(path.join(dir, "hang.md"), DOC);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (event: unknown, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [hook], { cwd: dir, input: typeof event === "string" ? event : JSON.stringify(event), encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000 });

describe("dogfood-links hook (R4.2)", () => {
  it("prints Tombstone, Ghost and Zombie links with their snapshot, and nothing else", () => {
    for (const input of [{ tool_input: { path: "doc.md" } }, { tool_input: { file_path: path.join(dir, "doc.md") } }, { toolArgs: { filePath: "doc.md" } }]) {
      const r = run({ tool_name: "fs_write", ...input }, { LYCHGATE_MCP_ENTRY: fake });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("3 dead links in doc.md");
      expect(r.stdout).toContain("Tombstone: https://gone.example/a (doc.md:3)\n  snapshot: https://web.archive.org/web/2020/https://gone.example/a");
      expect(r.stdout).toContain("Ghost: https://soft.example/b (doc.md:5)\n  snapshot: none found");
      expect(r.stdout).toContain("Zombie: https://parked.example/c");
      expect(r.stdout).not.toContain("slow.example");
      expect(r.stdout).toMatch(/do not edit the file without asking/);
    }
  });

  it("never edits the file", () => {
    run({ tool_input: { path: "doc.md" } }, { LYCHGATE_MCP_ENTRY: fake });
    expect(readFileSync(path.join(dir, "doc.md"), "utf8")).toBe(DOC);
  });

  it("exits 0 and stays silent for non-Markdown files, bad input, outside paths and missing files", () => {
    for (const ev of [{ tool_input: { path: "notes.txt" } }, "not json", {}, { tool_input: { path: "../outside.md" } }, { tool_input: { path: "missing.md" } }]) {
      const r = run(ev, { LYCHGATE_MCP_ENTRY: fake });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  });

  it("exits 0 and stays silent when the dist is missing", () => {
    const r = run({ tool_input: { path: "doc.md" } }, { LYCHGATE_MCP_ENTRY: path.join(dir, "no-such/index.js") });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
  });

  it("times out quietly", () => {
    const r = run({ tool_input: { path: "hang.md" } }, { LYCHGATE_MCP_ENTRY: fake, LYCHGATE_HOOK_TIMEOUT_MS: "1500" });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
  });

  it.skipIf(!existsSync(dist))("with the real server, a Sealed-only file reports nothing and exits 0 (no network)", () => {
    const r = run({ tool_input: { path: "doc.md" } }, { LYCHGATE_MCP_ENTRY: dist });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
