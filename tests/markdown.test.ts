import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { extractMarkdownLinks } from "@/lib/extract/markdown";
import { escapeForKind, patchMarkdown, unifiedDiff } from "@/lib/patch/patch";

const DOC = `# Title

Inline [docs](https://example.com/docs "Docs title") and ![img](https://img.example/a.png).
Autolink <https://auto.example/x> and literal https://literal.example/path.
A www literal: www.wwwsite.example/page
Ref [ref link][r1] and [another][R1].

[r1]: https://ref.example/target  "Ref title"
[r2]: <https://angle.example/with space>

<a href="https://html.example/a?x=1&amp;y=2">html link</a>

\`\`\`
https://in-code-block.example/ignored
\`\`\`

Inline code \`https://inline-code.example/ignored\` too.
Wikipedia [paren](https://en.wikipedia.org/wiki/Foo_(bar)) link.
Relative [rel](./docs/x.md) and [mail](mailto:a@b.c) are skipped.
`;

describe("extractMarkdownLinks", () => {
  const links = extractMarkdownLinks(DOC);
  it("finds every absolute link with its kind", () => {
    expect(links.map((l) => [l.kind, l.url])).toEqual([
      ["inline", "https://example.com/docs"],
      ["image", "https://img.example/a.png"],
      ["autolink", "https://auto.example/x"],
      ["literal", "https://literal.example/path"],
      ["literal", "http://www.wwwsite.example/page"],
      ["definition", "https://ref.example/target"],
      ["definition", "https://angle.example/with space"],
      ["html", "https://html.example/a?x=1&y=2"],
      ["inline", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ]);
  });
  it("skips code blocks, inline code, relative and mailto links", () => {
    const urls = links.map((l) => l.url).join(" ");
    expect(urls).not.toContain("ignored");
    expect(urls).not.toContain("mailto");
    expect(urls).not.toContain("docs/x.md");
  });
  it("records exact spans and line numbers", () => {
    for (const l of links) expect(DOC.slice(l.start, l.end)).toBe(l.raw);
    expect(links[0].line).toBe(3);
    expect(links.find((l) => l.kind === "definition")!.line).toBe(8);
    expect(links.find((l) => l.raw === "www.wwwsite.example/page")).toBeTruthy();
    expect(links.find((l) => l.kind === "html")!.raw).toBe("https://html.example/a?x=1&amp;y=2");
  });
  it("handles an empty-label link and plain URL lists", () => {
    expect(extractMarkdownLinks("[](https://e.example/)")[0].url).toBe("https://e.example/");
    const list = extractMarkdownLinks("https://a.example/1\nhttps://b.example/2\n");
    expect(list.map((l) => l.url)).toEqual(["https://a.example/1", "https://b.example/2"]);
  });
});

describe("patchMarkdown", () => {
  it("rewrites only the targeted URLs, everywhere they occur", () => {
    const src = "See [a](https://dead.example/x) and https://dead.example/x and [b](https://alive.example/).\n";
    const r = patchMarkdown(src, new Map([["https://dead.example/x", "https://web.archive.org/web/2015/https://dead.example/x"]]));
    expect(r.content).toBe(
      "See [a](https://web.archive.org/web/2015/https://dead.example/x) and https://web.archive.org/web/2015/https://dead.example/x and [b](https://alive.example/).\n",
    );
    expect(r.changed).toHaveLength(2);
  });
  it("patches reference definitions, autolinks, images and HTML attributes", () => {
    const map = new Map(extractMarkdownLinks(DOC).map((l) => [l.canonical, `https://web.archive.org/web/1/${l.canonical}`]));
    const out = patchMarkdown(DOC, map).content;
    const after = extractMarkdownLinks(out);
    expect(after).toHaveLength(9);
    for (const l of after) expect(l.url.startsWith("https://web.archive.org/web/1/")).toBe(true);
    expect(out).toContain("https://in-code-block.example/ignored");
  });
  it("is a no-op with no replacements", () => {
    expect(patchMarkdown(DOC, new Map()).content).toBe(DOC);
  });
  it("escapes characters that would break the surrounding syntax", () => {
    expect(escapeForKind("https://a.example/x y", { kind: "inline", raw: "" })).toBe("https://a.example/x%20y");
    expect(escapeForKind("https://a.example/x)", { kind: "inline", raw: "" })).toBe("https://a.example/x%29");
    expect(escapeForKind("https://a.example/(ok)", { kind: "inline", raw: "" })).toBe("https://a.example/(ok)");
    expect(escapeForKind("https://a.example/<x>", { kind: "autolink", raw: "" })).toBe("https://a.example/%3Cx%3E");
    expect(escapeForKind(`https://a.example/"q'`, { kind: "html", raw: "" })).toBe("https://a.example/%22q%27");
  });

  it("property: changes only the targeted URLs; all other text and links survive", () => {
    const seg = fc.oneof(
      fc.constantFrom("Some words. ", "\n\n", "- item ", "## Heading\n", "`code` ", "> quote\n"),
      fc.integer({ min: 0, max: 9 }).map((i) => `[t${i}](https://h${i}.example/p${i}) `),
      fc.integer({ min: 0, max: 9 }).map((i) => `https://h${i}.example/p${i} `),
      fc.integer({ min: 0, max: 9 }).map((i) => `<https://h${i}.example/p${i}> `),
    );
    fc.assert(
      fc.property(fc.array(seg, { maxLength: 30 }), fc.subarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), (parts, targets) => {
        const src = parts.join("");
        const map = new Map(targets.map((i) => [`https://h${i}.example/p${i}`, `https://web.archive.org/web/2001/https://h${i}.example/p${i}`]));
        const before = extractMarkdownLinks(src);
        const out = patchMarkdown(src, map).content;
        const after = extractMarkdownLinks(out);
        expect(after.length).toBe(before.length);
        for (let k = 0; k < before.length; k++) {
          const b = before[k];
          const a = after[k];
          if (map.has(b.canonical)) expect(a.url).toBe(map.get(b.canonical));
          else expect(a.url).toBe(b.url);
        }
        // Undo the replacements textually: we must get the original back.
        let undone = out;
        for (const [from, to] of map) undone = undone.split(to).join(from);
        expect(undone).toBe(src);
      }),
      { numRuns: 300 },
    );
  });
});

describe("unifiedDiff", () => {
  it("produces a git-style patch, or nothing when unchanged", () => {
    const d = unifiedDiff("README.md", "a\nlink https://x.example/\n", "a\nlink https://y.example/\n");
    expect(d).toContain("--- a/README.md");
    expect(d).toContain("+++ b/README.md");
    expect(d).toContain("-link https://x.example/");
    expect(d).toContain("+link https://y.example/");
    expect(unifiedDiff("x", "same", "same")).toBe("");
  });
});
