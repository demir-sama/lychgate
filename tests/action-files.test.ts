import fc from "fast-check";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findMarkdown, matchGlob, matchPaths } from "../action/src/files";
import { MAX_MD_FILES, rankMarkdownPaths } from "@/lib/github/repo";

describe("matchGlob (R5.4)", () => {
  it("handles **, *, ? and root files", () => {
    expect(matchGlob("**/*.md", "README.md")).toBe(true);
    expect(matchGlob("**/*.md", "a/b/c.md")).toBe(true);
    expect(matchGlob("*.md", "a/b.md")).toBe(false);
    expect(matchGlob("docs/*.md", "docs/x.md")).toBe(true);
    expect(matchGlob("docs/**", "docs/a/b.md")).toBe(true);
    expect(matchGlob("do?s/x.md", "docs/x.md")).toBe(true);
  });
  it("never matches a path that has .. in it", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom("a", "..", "b.md"), { minLength: 1 }), (segs) => {
      const p = segs.join("/");
      if (segs.includes("..")) expect(matchGlob("**", p)).toBe(false);
    }));
  });
  it("treats regex characters in a pattern literally", () => {
    expect(matchGlob("a+b(1).md", "a+b(1).md")).toBe(true);
    expect(matchGlob("a.md", "aXmd")).toBe(false);
  });
  it("! excludes", () => {
    const all = ["README.md", "docs/a.md", "docs/old/b.md"];
    expect(matchPaths(all, ["docs/**", "!docs/old/**"])).toEqual(["docs/a.md"]);
    expect(matchPaths(all, ["!docs/**"])).toEqual(["README.md"]);
  });
});

describe("rankMarkdownPaths limit (R5.4)", () => {
  it("defaults to MAX_MD_FILES and takes an optional limit", () => {
    const many = Array.from({ length: 60 }, (_, i) => `f${i}.md`);
    expect(rankMarkdownPaths(many)).toHaveLength(MAX_MD_FILES);
    expect(rankMarkdownPaths(many, undefined, 50)).toHaveLength(50);
    expect(rankMarkdownPaths(many, undefined, 3)).toHaveLength(3);
  });
});

function tree() {
  const root = mkdtempSync(path.join(tmpdir(), "lg-files-"));
  const w = (p: string, c = "# hi\n") => {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  };
  return { root, w };
}

describe("findMarkdown (R5.4)", () => {
  it("skips vendored dirs, ranks README first and cuts at max-files", async () => {
    const { root, w } = tree();
    w("README.md");
    w("docs/guide.md");
    w("a/b/c/deep.md");
    w("node_modules/x/README.md");
    w("vendor/y.md");
    w("dist/z.md");
    w("notes.txt");
    w("other.markdown");
    const all = await findMarkdown(root, ["**/*.md", "**/*.markdown"], 50);
    expect(all.files.map((f) => f.path)[0]).toBe("README.md");
    expect(all.files.map((f) => f.path).sort()).toEqual(["README.md", "a/b/c/deep.md", "docs/guide.md", "other.markdown"]);
    const two = await findMarkdown(root, ["**/*.md"], 2);
    expect(two.files.map((f) => f.path)).toEqual(["README.md", "docs/guide.md"]);
    expect(two.files[0].content).toBe("# hi\n");
  });
  it("ignores a symlink that points outside the workspace and one that points inside", async () => {
    const { root, w } = tree();
    const outside = tree();
    outside.w("secret.md", "[x](https://secret.example/)");
    w("README.md");
    w("real.md");
    symlinkSync(path.join(outside.root, "secret.md"), path.join(root, "leak.md"));
    symlinkSync(path.join(root, "real.md"), path.join(root, "alias.md"));
    symlinkSync(outside.root, path.join(root, "linkdir"));
    const r = await findMarkdown(root, ["**/*.md"], 20);
    expect(r.files.map((f) => f.path).sort()).toEqual(["README.md", "real.md"]);
  });
  it("reports an unreadable workspace", async () => {
    await expect(findMarkdown("/definitely/not/here", ["**/*.md"], 5)).rejects.toThrow();
  });
});
