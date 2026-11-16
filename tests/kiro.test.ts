import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const hooks = JSON.parse(readFileSync(path.join(root, ".kiro/hooks/lychgate.json"), "utf8")) as {
  version: string;
  hooks: Array<{ name: string; trigger: string; matcher?: string; enabled?: boolean; action: { type: string; command?: string; prompt?: string } }>;
};
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
const TRIGGERS = new Set(["SessionStart", "Stop", "UserPromptSubmit", "PreTaskExec", "PostTaskExec", "PreToolUse", "PostToolUse", "PostFileCreate", "PostFileSave", "PostFileDelete"]);

describe("Kiro hooks stay in sync with the repo", () => {
  it("uses the v1 schema with unique names and known triggers", () => {
    expect(hooks.version).toBe("v1");
    const names = hooks.hooks.map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
    for (const h of hooks.hooks) {
      expect(TRIGGERS.has(h.trigger), h.name).toBe(true);
      if (h.matcher) expect(() => new RegExp(h.matcher!)).not.toThrow();
      expect(["command", "agent"]).toContain(h.action.type);
      if (h.action.type === "command") expect(h.action.command, h.name).toBeTruthy();
      else expect(h.action.prompt, h.name).toBeTruthy();
    }
  });

  it("only references test files, scripts and pnpm scripts that exist", () => {
    for (const h of hooks.hooks.filter((x) => x.action.type === "command")) {
      const cmd = h.action.command!;
      for (const f of cmd.match(/tests\/[\w.-]+\.test\.ts/g) ?? []) expect(existsSync(path.join(root, f)), `${h.name}: ${f}`).toBe(true);
      for (const f of cmd.match(/scripts\/[\w./-]+\.mjs/g) ?? []) expect(existsSync(path.join(root, f)), `${h.name}: ${f}`).toBe(true);
      const run = /pnpm (?:-s )?([\w:-]+)/.exec(cmd)?.[1];
      if (run && run !== "vitest") expect(pkg.scripts[run], `${h.name}: pnpm ${run}`).toBeTruthy();
    }
  });

  it("matchers fire on the files they guard", () => {
    const m = (name: string) => new RegExp(hooks.hooks.find((h) => h.name === name)!.matcher!);
    expect(m("classifier-property-suite").test("lib/classify/classify.ts")).toBe(true);
    expect(m("ssrf-guard-suite").test("lib/fetch/guard.ts")).toBe(true);
    expect(m("ssrf-guard-suite").test("lib/net/ip.ts")).toBe(true);
    expect(m("ssrf-guard-suite").test("lib/scan/engine.ts")).toBe(false);
  });
});

describe("block-env-writes hook", () => {
  const run = (input: unknown) => spawnSync(process.execPath, [path.join(root, "scripts/hooks/block-env-writes.mjs")], { input: JSON.stringify(input), encoding: "utf8" });
  it("blocks .env files with exit code 2", () => {
    for (const p of [".env", ".env.local", "apps/web/.env.production"]) {
      expect(run({ tool_name: "fs_write", tool_input: { path: p } }).status, p).toBe(2);
    }
  });
  it("allows .env.example and ordinary files", () => {
    expect(run({ tool_name: "fs_write", tool_input: { path: ".env.example" } }).status).toBe(0);
    expect(run({ tool_name: "fs_write", tool_input: { path: "lib/fetch/guard.ts" } }).status).toBe(0);
    expect(run({ toolName: "write", toolArgs: { file_path: "README.md" } }).status).toBe(0);
  });
});
