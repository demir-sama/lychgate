import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FixInputSchema,
  PathsSchema,
  ReplacementsSchema,
  branchName,
  commitMessage,
  parseRepoSlug,
  planFix,
  prBody,
  prTitle,
  whyOf,
} from "@/lib/fix/plan";

// fix-it R1.1 to R1.9. Fake tokens are built at run time so the secret scan stays green.
const TOKEN = "ghp_" + "a".repeat(36);
const WAYBACK = (n: number) => `https://web.archive.org/web/2019010100000${n % 10}/https://h${n}.example/p`;

const plain = fc.stringMatching(/^[A-Za-z0-9 ]{0,12}(\r?\n)?$/);
const ids = fc.integer({ min: 0, max: 5 });

describe("planFix (R1.1 to R1.3, R1.7)", () => {
  it("changes only the link spans, keeping CRLF, BOM and a missing final newline", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(plain, ids), { minLength: 1, maxLength: 8 }),
        fc.uniqueArray(ids, { maxLength: 6 }),
        fc.boolean(),
        fc.boolean(),
        (parts, chosen, bom, tailNewline) => {
          const to = (n: number) => `https://new${n}.example/p/${n}`;
          const map = chosen.map((n) => ({ from: `https://h${n}.example/p`, to: to(n) }));
          const chosenSet = new Set(chosen);
          let src = bom ? "\uFEFF" : "";
          let want = src;
          for (const [text, n] of parts) {
            src += `${text} [x](https://h${n}.example/p) `;
            want += `${text} [x](${chosenSet.has(n) ? to(n) : `https://h${n}.example/p`}) `;
          }
          if (tailNewline) {
            src += "\r\n";
            want += "\r\n";
          }
          const plan = planFix([{ path: "README.md", content: src }], map);
          if (want === src) {
            expect(plan.files).toEqual([]);
            expect(plan.links).toEqual([]);
          } else {
            expect(plan.files).toHaveLength(1);
            expect(plan.files[0].before).toBe(src);
            expect(plan.files[0].after).toBe(want);
          }
        },
      ),
    );
  });

  it("drops unchanged files and lists only links that were rewritten", () => {
    const plan = planFix(
      [
        { path: "a.md", content: "[a](https://old.example/a) and [b](https://old.example/b)\n" },
        { path: "b.md", content: "nothing here\n" },
        { path: "docs/c.md", content: "<https://old.example/a>\n" },
      ],
      [
        { from: "https://old.example/a", to: WAYBACK(1) },
        { from: "https://old.example/zzz", to: "https://new.example/z" },
      ],
    );
    expect(plan.files.map((f) => f.path)).toEqual(["a.md", "docs/c.md"]);
    expect(plan.files[0].links).toEqual(["https://old.example/a"]);
    expect(plan.links).toEqual([{ from: "https://old.example/a", to: WAYBACK(1), why: "Wayback snapshot", paths: ["a.md", "docs/c.md"] }]);
    expect(plan.files[0].after).toContain("[b](https://old.example/b)");
  });

  it("returns an empty plan when nothing matches", () => {
    const plan = planFix([{ path: "a.md", content: "[a](https://x.example/)" }], [{ from: "https://old.example/a", to: "https://n.example/" }]);
    expect(plan).toMatchObject({ files: [], links: [] });
  });

  it("derives why from the target (R1.7)", () => {
    expect(whyOf("https://web.archive.org/web/2019/https://a.example/")).toBe("Wayback snapshot");
    expect(whyOf("https://new.example/a")).toBe("living replacement");
  });

  it("counts distinct links in commit messages and the title (R1.8)", () => {
    const plan = planFix(
      [
        { path: "a.md", content: "[a](https://o.example/1) [a2](https://o.example/1) [b](https://o.example/2)" },
        { path: "b.md", content: "[a](https://o.example/1)" },
      ],
      [
        { from: "https://o.example/1", to: "https://n.example/1" },
        { from: "https://o.example/2", to: "https://n.example/2" },
      ],
    );
    expect(plan.files.map((f) => f.message)).toEqual(["Lychgate: resurrect 2 dead links in a.md", "Lychgate: resurrect 1 dead link in b.md"]);
    expect(plan.title).toBe("Lychgate: resurrect 2 dead links");
    expect(commitMessage("x.md", 1)).toBe("Lychgate: resurrect 1 dead link in x.md");
    expect(prTitle(1)).toBe("Lychgate: resurrect 1 dead link");
  });
});

describe("prBody (R1.9)", () => {
  const link = (n: number, extra = "") => ({ from: `https://o${n}.example/a${extra}`, to: `https://n${n}.example/b`, why: "living replacement" as const, paths: ["README.md"] });

  it("has an intro, a table, the footer, the old URL in a code span", () => {
    const body = prBody([link(1)]);
    expect(body).toContain("| Was | Now | Why | Files |");
    expect(body).toContain("`https://o1.example/a`");
    expect(body).toContain("living replacement");
    expect(body.trimEnd().endsWith("_Opened with [Lychgate](https://github.com/demir-sama/lychgate)_")).toBe(true);
  });

  it("escapes pipes and line breaks in cells and backticks in URLs", () => {
    const body = prBody([{ from: "https://o.example/a?x=|y`z", to: "https://n.example/a|b", why: "living replacement", paths: ["a|b.md", "c\nd.md"] }]);
    const rows = body.split("\n").filter((l) => l.startsWith("| `"));
    expect(rows).toHaveLength(1);
    // 4 cells: only unescaped pipes split a table row
    expect(rows[0].split(/(?<!\\)\|/)).toHaveLength(6);
    expect(rows[0]).toContain("a\\|b");
    expect(rows[0]).toContain("%60");
    expect(body).not.toContain("c\nd.md");
  });

  it("stays at or under 60,000 characters and says how many links it left out", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: 1500 }), (n, pad) => {
        const links = Array.from({ length: n }, (_, i) => link(i, "/" + "p".repeat(pad)));
        const body = prBody(links);
        expect(body.length).toBeLessThanOrEqual(60_000);
        const rows = body.split("\n").filter((l) => l.startsWith("| `")).length;
        if (rows < n) expect(body).toContain(`${n - rows} more`);
        else expect(body).not.toMatch(/\d+ more/);
      }),
      { numRuns: 40 },
    );
  });
});

describe("branchName", () => {
  it("is lychgate/fix-<UTC date>-<6 base36>", () => {
    const rnd = () => 0.999;
    expect(branchName(new Date("2026-11-26T23:59:59Z"), rnd)).toBe("lychgate/fix-20261126-zzzzzz");
    fc.assert(
      fc.property(fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }), fc.double({ min: 0, max: 0.9999999, noNaN: true }), (d, r) => {
        expect(branchName(d, () => r)).toMatch(/^lychgate\/fix-\d{8}-[0-9a-z]{6}$/);
      }),
    );
  });
});

describe("validation (R1.4 to R1.6)", () => {
  const okRep = { from: "https://old.example/a", to: "https://web.archive.org/web/2019/https://old.example/a" };

  it("accepts a sound replacement list", () => {
    expect(ReplacementsSchema.safeParse([okRep]).success).toBe(true);
  });

  it("refuses bad replacements", () => {
    const bad: unknown[] = [
      [],
      [{ from: "ftp://a.example/", to: "https://b.example/" }],
      [{ from: "https://a.example/", to: "javascript:alert(1)" }],
      [{ from: "https://A.example", to: "https://b.example/" }], // not canonical
      [{ from: "https://a.example/#frag", to: "https://b.example/" }],
      [{ from: "https://a.example/", to: "https://a.example/" }],
      [okRep, { from: okRep.from, to: "https://other.example/" }], // duplicate from
      [{ from: "https://a.example/" + "x".repeat(2048), to: "https://b.example/" }],
      [{ from: "https://a.example/", to: "https://b.example/" + "x".repeat(2048) }],
      Array.from({ length: 301 }, (_, i) => ({ from: `https://o${i}.example/`, to: `https://n${i}.example/` })),
    ];
    for (const b of bad) expect(ReplacementsSchema.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
    expect(ReplacementsSchema.safeParse(Array.from({ length: 300 }, (_, i) => ({ from: `https://o${i}.example/`, to: `https://n${i}.example/` }))).success).toBe(true);
  });

  it("accepts a canonical from for any http(s) URL it is built from", () => {
    fc.assert(
      fc.property(fc.webUrl(), (u) => {
        const r = ReplacementsSchema.safeParse([{ from: u, to: "https://z.example/zz" }]);
        // when it passes, from is its own canonical form
        if (r.success) expect(new URL(r.data[0].from).hash).toBe("");
      }),
    );
  });

  it("validates paths", () => {
    expect(PathsSchema.safeParse(["README.md", "docs/a.MARKDOWN", "a b/c.md"]).success).toBe(true);
    const bad: unknown[] = [
      [],
      ["README.txt"],
      ["../a.md"],
      ["a/../b.md"],
      ["/a.md"],
      ["a\\b.md"],
      ["a\0.md"],
      ["a\n.md"],
      ["a//b.md"],
      [".git/a.md"],
      ["x/.git/a.md"],
      ["./a.md"],
      ["a.md", "a.md"],
      ["x".repeat(298) + ".md"],
      Array.from({ length: 21 }, (_, i) => `f${i}.md`),
    ];
    for (const b of bad) expect(PathsSchema.safeParse(b).success, JSON.stringify(b).slice(0, 60)).toBe(false);
    expect(PathsSchema.safeParse(Array.from({ length: 20 }, (_, i) => `f${i}.md`)).success).toBe(true);
  });

  it("refuses any path with a '..' segment or a control character", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{1,5}$/), { maxLength: 3 }), fc.array(fc.stringMatching(/^[a-z]{1,5}$/), { maxLength: 3 }), (a, b) => {
        expect(PathsSchema.safeParse([[...a, "..", ...b, "x.md"].join("/")]).success).toBe(false);
        expect(PathsSchema.safeParse([[...a, "x\u0007y.md"].join("/")]).success).toBe(false);
      }),
    );
  });

  it("parses only exact owner/repo slugs", () => {
    expect(parseRepoSlug("demir-sama/lychgate")).toEqual({ owner: "demir-sama", repo: "lychgate" });
    expect(parseRepoSlug("a.b/c_d-e.js")).toEqual({ owner: "a.b", repo: "c_d-e.js" });
    for (const s of [
      "",
      "owner",
      "owner/",
      "/repo",
      "o/r/extra",
      "https://github.com/o/r",
      "github.com/o/r",
      "o/r.git",
      "o/r/tree/main",
      "o/..",
      "../r",
      "./.",
      "o/ r",
      "o/r\n",
      "o/" + "r".repeat(101),
      "o@x/r",
      "o/r#main",
    ])
      expect(parseRepoSlug(s), JSON.stringify(s)).toBeNull();
  });

  it("FixInputSchema takes repo, token, replacements, paths and nothing else", () => {
    const good = { repo: "o/r", token: TOKEN, replacements: [okRep], paths: ["README.md"] };
    expect(FixInputSchema.safeParse(good).success).toBe(true);
    expect(FixInputSchema.safeParse({ ...good, why: "x" }).success).toBe(false);
    expect(FixInputSchema.safeParse({ ...good, replacements: [{ ...okRep, why: "x" }] }).success).toBe(false);
    for (const token of ["short", "has space " + "a".repeat(20), "a".repeat(20) + "\n", "a".repeat(256), "ghp_" + "é".repeat(30)])
      expect(FixInputSchema.safeParse({ ...good, token }).success, token.slice(0, 10)).toBe(false);
  });

  it("validation messages never repeat the submitted token", () => {
    const token = "bad token " + "Z".repeat(30);
    const r = FixInputSchema.safeParse({ repo: "o/r", token, replacements: [okRep], paths: ["README.md"] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).not.toContain("Z".repeat(30));
  });
});
