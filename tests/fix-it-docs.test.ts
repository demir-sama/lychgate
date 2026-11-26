import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("dogfood workflow (R6.1)", () => {
  const yml = read(".github/workflows/lychgate.yml");
  it("runs on pull requests touching Markdown, weekly and by hand", () => {
    expect(yml).toMatch(/^on:/m);
    expect(yml).toMatch(/pull_request:/);
    expect(yml).toMatch(/\*\*\/\*\.md/);
    expect(yml).toMatch(/schedule:\s*\n\s*- cron: /);
    expect(yml).toMatch(/workflow_dispatch:/);
  });
  it("is read-only, deep-cloned, credential-free and uses the local action", () => {
    expect(yml).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(yml).toMatch(/fetch-depth: 0/);
    expect(yml).toMatch(/persist-credentials: false/);
    expect(yml).toMatch(/uses: \.\/\s*$/m);
    expect(yml).toMatch(/timeout-minutes: 10/);
  });
  it("uses no secrets", () => {
    expect(yml).not.toMatch(/secrets\./);
  });
});

describe("README (R6.2, R6.4)", () => {
  const readme = read("README.md");
  it("has Fix it and GitHub Action sections", () => {
    expect(readme).toMatch(/^## Fix it$/m);
    expect(readme).toMatch(/^## GitHub Action$/m);
  });
  it("explains the token, its scopes and the fallback downloads", () => {
    const s = readme.split(/^## Fix it$/m)[1]!.split(/^## /m)[0]!;
    expect(s).toMatch(/Contents/);
    expect(s).toMatch(/Pull requests/);
    expect(s).toMatch(/not stored/i);
    expect(s).toMatch(/download/i);
  });
  it("documents the action inputs, outputs and fail-on", () => {
    const s = readme.split(/^## GitHub Action$/m)[1]!.split(/^## /m)[0]!;
    for (const k of ["paths", "max-files", "fail-on", "cite-dates", "health", "dead", "fetch-depth: 0", "uses: demir-sama/lychgate@"]) {
      expect(s).toContain(k);
    }
  });
  it("mentions both in the status list", () => {
    const s = readme.split(/^## Status/m)[1]!.split(/^## /m)[0]!;
    expect(s).toMatch(/Fix it/);
    expect(s).toMatch(/GitHub Action/);
  });
});

describe("lychgate-mcp README (R6.3)", () => {
  const md = read("packages/lychgate-mcp/README.md");
  it("says the server is read-only and never opens pull requests", () => {
    expect(md).toMatch(/read-only/i);
    expect(md).toMatch(/never opens pull requests/i);
    expect(md).toMatch(/Fix it/);
    expect(md).toMatch(/GitHub Action/);
  });
});
