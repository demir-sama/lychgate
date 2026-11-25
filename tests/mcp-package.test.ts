import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const pkgDir = path.join(root, "packages/lychgate-mcp");
const read = (p: string) => readFileSync(path.join(pkgDir, p), "utf8");

describe("lychgate-mcp package (R1.2, R1.3)", () => {
  const pkg = () => JSON.parse(read("package.json")) as Record<string, any>;

  it("is a publishable MIT package with a bin entry", () => {
    const p = pkg();
    expect(p.name).toBe("lychgate-mcp");
    expect(p.license).toBe("MIT");
    expect(p.private).not.toBe(true);
    expect(p.bin).toEqual({ "lychgate-mcp": "dist/index.js" });
    expect(p.files).toContain("dist");
    expect(p.author).toMatch(/demir-sama/);
  });

  it("README shows the Kiro mcp.json snippet", () => {
    const readme = read("README.md");
    expect(readme).toContain("mcpServers");
    expect(readme).toContain("lychgate");
    expect(readme).toContain("dist/index.js");
    expect(readme).toContain(".kiro/settings/mcp.json");
  });

  it("root package.json depends on the SDK and has mcp:build", () => {
    const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(rootPkg.scripts["mcp:build"]).toBeTruthy();
    expect({ ...rootPkg.dependencies, ...rootPkg.devDependencies }["@modelcontextprotocol/sdk"]).toBeTruthy();
  });

  it("pnpm mcp:build writes a single runnable dist/index.js (R1.2)", () => {
    const r = spawnSync("pnpm", ["-s", "mcp:build"], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = path.join(pkgDir, "dist/index.js");
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
    const syntax = spawnSync("node", ["--check", out], { encoding: "utf8" });
    expect(syntax.status, syntax.stderr).toBe(0);
  }, 60_000);

  it("the server identifies itself as lychgate with the package version (R1.1)", () => {
    expect(read("src/server.ts")).toMatch(/name:\s*"lychgate",\s*version:\s*pkg\.version/);
    expect(read("src/index.ts")).toContain("StdioServerTransport");
  });
});
