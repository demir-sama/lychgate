import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_PATHS, isValidPath, planFix } from "@/lib/fix/plan";
import {
  MAX_FIX_BODY,
  bodyBytes,
  buildFixBody,
  describeFixError,
  fixPreview,
  isScanOfDefaultBranch,
  scanFixTarget,
} from "@/lib/fix/panel";
import type { Doc } from "@/lib/scan/types";

const TOKEN = "ghp_" + "a".repeat(36);
const doc = (p: string, content: string): Doc => ({ path: p, content }) as Doc;
const wb = (u: string) => `https://web.archive.org/web/20200101000000/${u}`;

describe("isScanOfDefaultBranch and scanFixTarget (R4.1)", () => {
  it("accepts plain slugs and repo URLs", () => {
    for (const s of ["owner/repo", " owner/repo ", "https://github.com/owner/repo", "github.com/owner/repo/", "https://www.github.com/owner/repo.git"]) {
      expect(isScanOfDefaultBranch(s), s).toBe(true);
      expect(scanFixTarget("github", s)).toEqual({ slug: "owner/repo", defaultBranch: true });
    }
  });
  it("refuses a branch, a path or another host", () => {
    for (const s of ["https://github.com/owner/repo/tree/dev", "owner/repo/tree/main/docs", "https://github.com/owner/repo/blob/main/README.md", "https://gitlab.com/owner/repo", "owner", ""]) {
      expect(isScanOfDefaultBranch(s), s).toBe(false);
    }
  });
  it("names the repository but marks a branch scan", () => {
    expect(scanFixTarget("github", "https://github.com/owner/repo/tree/dev")).toEqual({ slug: "owner/repo", defaultBranch: false });
  });
  it("is null for website and Markdown scans and unparsable input", () => {
    expect(scanFixTarget("site", "owner/repo")).toBeNull();
    expect(scanFixTarget("markdown", "owner/repo")).toBeNull();
    expect(scanFixTarget("github", "nonsense")).toBeNull();
  });
  it("never yields a slug the server would refuse (property)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const t = scanFixTarget("github", s);
        if (t) expect(t.slug).toMatch(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
      }),
    );
  });
});

describe("fixPreview (R4.3, R4.5)", () => {
  const docs = [doc("README.md", "[a](https://a.example/x) and [b](https://b.example/y)\n"), doc("docs/guide.md", "see https://a.example/x\n"), doc("notes.md", "nothing here\n")];
  const map = new Map([
    ["https://a.example/x", wb("https://a.example/x")],
    ["https://b.example/y", "https://new.example/y"],
    ["https://absent.example/", "https://other.example/"],
  ]);

  it("counts the links and files the patch changes, and sends only those", () => {
    const p = fixPreview(docs, map);
    expect(p.files).toBe(2);
    expect(p.links).toBe(2);
    expect(p.paths).toEqual(["README.md", "docs/guide.md"]);
    expect(p.replacements.map((r) => r.from).sort()).toEqual(["https://a.example/x", "https://b.example/y"]);
  });

  it("agrees with the server plan on the same input (property)", () => {
    const urls = ["https://a.example/x", "https://b.example/y", "https://c.example/z"];
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom("README.md", "docs/a.md", "b.markdown", "c.mdx", "x.txt"), fc.subarray(urls)), { maxLength: 6 }),
        fc.subarray(urls),
        (rows, chosen) => {
          const seen = new Set<string>();
          const ds = rows.filter(([p]) => !seen.has(p) && seen.add(p)).map(([p, us]) => doc(p, us.map((u) => `[l](${u})`).join("\n") + "\n"));
          const m = new Map(chosen.map((u) => [u, wb(u)]));
          const p = fixPreview(ds, m);
          const plan = planFix(ds.filter((d) => isValidPath(d.path)).map((d) => ({ path: d.path, content: d.content })), p.replacements);
          expect(p.paths).toEqual(plan.files.map((f) => f.path));
          expect(p.links).toBe(plan.links.length);
          expect(p.files).toBe(plan.files.length);
          for (const x of p.paths) expect(isValidPath(x)).toBe(true);
        },
      ),
    );
  });

  it("leaves out .mdx files, which the server refuses", () => {
    const p = fixPreview([doc("a.mdx", "[a](https://a.example/x)\n")], new Map([["https://a.example/x", "https://n.example/"]]));
    expect(p.files).toBe(0);
    expect(p.paths).toEqual([]);
  });

  it("caps paths at 20 and reports what it left out", () => {
    const many = Array.from({ length: 25 }, (_, i) => doc(`d${i}.md`, "[a](https://a.example/x)\n"));
    const p = fixPreview(many, new Map([["https://a.example/x", "https://n.example/"]]));
    expect(p.paths).toHaveLength(MAX_PATHS);
    expect(p.omittedFiles).toBe(5);
    expect(p.files).toBe(20);
  });

  it("drops a target that is not an http(s) URL or is too long", () => {
    const p = fixPreview([doc("a.md", "[a](https://a.example/x)\n[b](https://b.example/y)\n")], new Map([["https://a.example/x", "javascript:alert(1)"], ["https://b.example/y", "https://n.example/" + "a".repeat(2100)]]));
    expect(p.links).toBe(0);
    expect(p.replacements).toEqual([]);
  });

  it("is empty when nothing is chosen", () => {
    expect(fixPreview(docs, new Map())).toMatchObject({ files: 0, links: 0, paths: [], replacements: [], omittedFiles: 0 });
  });
});

describe("bodyBytes and buildFixBody (R4.5)", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(bodyBytes({ a: "é" })).toBe(new TextEncoder().encode('{"a":"é"}').length);
    expect(bodyBytes({ a: "é" })).toBeGreaterThan('{"a":"é"}'.length);
  });
  it("builds the exact request body from the recorded slug", () => {
    const p = fixPreview([doc("README.md", "[a](https://a.example/x)\n")], new Map([["https://a.example/x", "https://n.example/"]]));
    const body = buildFixBody("owner/repo", TOKEN, p);
    expect(Object.keys(body).sort()).toEqual(["paths", "replacements", "repo", "token"]);
    expect(body.repo).toBe("owner/repo");
    expect(body.paths).toEqual(["README.md"]);
  });
  it("is over the cap when 300 long pairs are sent", () => {
    const body = { repo: "o/r", token: TOKEN, paths: ["a.md"], replacements: Array.from({ length: 300 }, (_, i) => ({ from: `https://a.example/${"x".repeat(1000)}${i}`, to: `https://b.example/${"y".repeat(1000)}${i}` })) };
    expect(bodyBytes(body)).toBeGreaterThan(MAX_FIX_BODY);
  });
  it("has the same cap as the route", () => {
    expect(MAX_FIX_BODY).toBe(64 * 1024);
    expect(readFileSync(path.resolve("app/api/fix/route.ts"), "utf8")).toMatch(/64 \* 1024/);
  });
});

describe("describeFixError (R4.8)", () => {
  it("keeps the server text and adds a next step", () => {
    expect(describeFixError(401, "GitHub refused the token.")).toMatch(/refused the token.*Contents.*Pull requests/s);
    expect(describeFixError(403, "The token cannot push to owner/repo.")).toMatch(/fork/i);
    expect(describeFixError(429, "Too many requests.")).toMatch(/wait/i);
    expect(describeFixError(413, "Too big.")).toMatch(/download/i);
    expect(describeFixError(504, "GitHub took too long.")).toMatch(/lychgate\//);
  });
  it("does not tell a private or archived repo owner to fork", () => {
    expect(describeFixError(403, "This repository is archived and read-only.")).not.toMatch(/fork/i);
  });
  it("does not say fork twice", () => {
    const m = describeFixError(403, "Fork the repository and scan the fork.");
    expect(m.match(/fork/gi)).toHaveLength(2);
  });
  it("falls back to the status when the server said nothing", () => {
    expect(describeFixError(502, "")).toMatch(/502/);
  });
  it("never shows a token, even one echoed by a server (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), fc.string(), fc.stringMatching(/^[A-Za-z0-9]{36}$/), (status, text, tail) => {
        const out = describeFixError(status, `${text} ghp_${tail} ${text}`);
        expect(out).not.toContain(`ghp_${tail}`);
        expect(out.length).toBeLessThanOrEqual(600);
      }),
    );
  });
});

describe("the token never meets storage, cookie, URL or console (R4.4)", () => {
  const read = (f: string) => readFileSync(path.resolve(f), "utf8");
  const files = ["components/graveyard/FixPanel.tsx", "lib/fix/panel.ts"];
  for (const f of files) {
    const src = read(f);
    it(`${f} has no storage, cookie, location or console`, () => {
      expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|\bconsole\./);
      expect(src).not.toMatch(/location\.(href|search|hash|assign|replace)|history\.(push|replace)State|URLSearchParams/);
    });
  }
  it("FixPanel has a password field, no autocomplete, no spell check, no name", () => {
    const src = read("components/graveyard/FixPanel.tsx");
    expect(src).toMatch(/type="password"/);
    expect(src).toMatch(/autoComplete="off"/);
    expect(src).toMatch(/spellCheck=\{false\}/);
    expect(src).not.toMatch(/<input[^>]*\sname=/);
    expect(src).toMatch(/showModal\(\)/);
    expect(src).toMatch(/rel="noopener"/);
    expect(src).toMatch(/role="alert"/);
    expect(src).toMatch(/aria-live="polite"/);
  });
  it("the token state is cleared in a finally and on close", () => {
    const src = read("components/graveyard/FixPanel.tsx");
    expect(src).toMatch(/finally\s*\{[^}]*setToken\(""\)/s);
    expect(src).toMatch(/onClose[\s\S]*setToken\(""\)|setToken\(""\)[\s\S]*onClose/);
  });
  it("Scanner records the scan target when the scan starts and never reads the live input for the PR", () => {
    const src = read("components/Scanner.tsx");
    expect(src).toMatch(/setScanTarget\(/);
    expect(src).toMatch(/<FixPanel/);
    expect(src).toMatch(/Open a pull request/);
    expect(src).not.toMatch(/setItem\([^)]*token/i);
  });
});
