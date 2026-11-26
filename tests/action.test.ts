import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const bundle = path.join(root, "action/dist/index.js");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("action.yml (R5.1)", () => {
  const yml = readFileSync(path.join(root, "action.yml"), "utf8");
  it("has the required fields", () => {
    expect(yml).toMatch(/^name: Lychgate link check$/m);
    expect(yml).toMatch(/using: node20/);
    expect(yml).toMatch(/main: action\/dist\/index\.js/);
    expect(yml).toMatch(/^author: .*Demir \(demir-sama\)/m);
    expect(yml).toMatch(/^description: /m);
  });
  it("declares the inputs and outputs with their defaults", () => {
    for (const k of ["paths", "max-files", "fail-on", "cite-dates"]) expect(yml).toMatch(new RegExp(`^  ${k}:`, "m"));
    expect(yml).toMatch(/default: "?\*\*\/\*\.md"?/);
    expect(yml).toMatch(/default: "?20"?/);
    expect(yml).toMatch(/default: "?tombstone,zombie"?/);
    expect(yml).toMatch(/default: "?git"?/);
    for (const k of ["health", "dead"]) expect(yml).toMatch(new RegExp(`^  ${k}:`, "m"));
  });
});

describe("the committed bundle (R5.2)", () => {
  beforeAll(() => {
    const pkg = JSON.parse(readFileSync(path.join(root, "action/dist/package.json"), "utf8"));
    expect(pkg).toEqual({ type: "module" });
  });

  it("is what a fresh build produces", () => {
    const before = sha(bundle);
    const pkgBefore = sha(path.join(root, "action/dist/package.json"));
    const b = spawnSync("pnpm", ["-s", "action:build"], { cwd: root, encoding: "utf8" });
    expect(b.status, b.stderr).toBe(0);
    expect(sha(bundle)).toBe(before);
    expect(sha(path.join(root, "action/dist/package.json"))).toBe(pkgBefore);
  }, 60_000);

  it("runs on a temp workspace with a Sealed link and no network", () => {
    const ws = mkdtempSync(path.join(tmpdir(), "lg-act-"));
    writeFileSync(path.join(ws, "README.md"), "# t\n\n[meta](http://169.254.169.254/latest)\n");
    const out = path.join(ws, "..", `out-${path.basename(ws)}.txt`);
    const sum = path.join(ws, "..", `sum-${path.basename(ws)}.md`);
    writeFileSync(out, "");
    writeFileSync(sum, "");
    const run = (failOn: string) =>
      spawnSync(process.execPath, [bundle], {
        cwd: ws,
        encoding: "utf8",
        env: { PATH: process.env.PATH, GITHUB_WORKSPACE: ws, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, "INPUT_FAIL-ON": failOn, "INPUT_CITE-DATES": "none" } as unknown as NodeJS.ProcessEnv,
        timeout: 60_000,
      });
    const ok = run("tombstone,zombie");
    expect(ok.status, ok.stderr + ok.stdout).toBe(0);
    expect(readFileSync(out, "utf8")).toMatch(/^health=\d+$/m);
    expect(readFileSync(out, "utf8")).toMatch(/^dead=0$/m);
    expect(readFileSync(sum, "utf8")).toContain("Lychgate link check");
    const bad = run("sealed");
    expect(bad.status).toBe(1);
    const invalid = run("living");
    expect(invalid.status).toBe(2);
    expect(invalid.stdout + invalid.stderr).toContain("fail-on");
  }, 120_000);
});
