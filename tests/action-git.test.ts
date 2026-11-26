import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { citeDatesFromGit } from "../action/src/git";

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), "lg-git-"));
  const git = (args: string[], date?: string) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], {
      cwd: root,
      env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
      stdio: "pipe",
    });
  git(["init", "-q"]);
  return { root, git };
}

describe("citeDatesFromGit (R5.5)", () => {
  it("dates a link by the commit that added it", async () => {
    const { root, git } = repo();
    writeFileSync(path.join(root, "a.md"), "[old](https://old.example/)\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"], "2019-01-01T00:00:00Z");
    writeFileSync(path.join(root, "a.md"), "[old](https://old.example/)\n[new](https://new.example/)\n");
    git(["commit", "-q", "-am", "two"], "2021-06-01T00:00:00Z");
    const r = await citeDatesFromGit(root, "a.md", ["https://old.example/", "https://new.example/"]);
    expect(r.warning).toBeUndefined();
    expect(r.dates.get("https://old.example/")!.date.slice(0, 10)).toBe("2019-01-01");
    expect(r.dates.get("https://new.example/")!.date.slice(0, 10)).toBe("2021-06-01");
  });
  it("a file name that looks like an option or a shell command is only an argument", async () => {
    const { root, git } = repo();
    const name = "--output=x; touch pwned.md";
    writeFileSync(path.join(root, name), "[a](https://a.example/)\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"], "2020-02-02T00:00:00Z");
    const r = await citeDatesFromGit(root, name, ["https://a.example/"]);
    expect(r.dates.get("https://a.example/")!.date.slice(0, 10)).toBe("2020-02-02");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).not.toContain("pwned");
  });
  it("a shallow clone gives a warning that names fetch-depth: 0", async () => {
    const src = repo();
    writeFileSync(path.join(src.root, "a.md"), "[a](https://a.example/)\n");
    src.git(["add", "."]);
    src.git(["commit", "-q", "-m", "one"], "2019-01-01T00:00:00Z");
    writeFileSync(path.join(src.root, "a.md"), "[a](https://a.example/) x\n");
    src.git(["commit", "-q", "-am", "two"], "2020-01-01T00:00:00Z");
    const dest = path.join(mkdtempSync(path.join(tmpdir(), "lg-shallow-")), "c");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${src.root}`, dest], { stdio: "pipe" });
    const r = await citeDatesFromGit(dest, "a.md", ["https://a.example/"]);
    expect(r.dates.size).toBe(0);
    expect(r.warning).toContain("fetch-depth: 0");
  });
  it("not a git repository, or no git binary, is a warning and not a crash", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lg-nogit-"));
    writeFileSync(path.join(dir, "a.md"), "x");
    const a = await citeDatesFromGit(dir, "a.md", ["https://a.example/"]);
    expect(a.dates.size).toBe(0);
    expect(a.warning).toBeTruthy();
    const b = await citeDatesFromGit(dir, "a.md", ["https://a.example/"], { git: "git-does-not-exist" });
    expect(b.dates.size).toBe(0);
    expect(b.warning).toBeTruthy();
  });
});
