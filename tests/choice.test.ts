import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LinkClass } from "@/lib/classify/classify";
import { choiceSummary, defaultChoice, reasonText, replacementMap, targetFor, type Choice, type Found } from "@/lib/patch/choice";
import { patchMarkdown } from "@/lib/patch/patch";
import type { LinkResult } from "@/lib/scan/types";

// resurrection-engine R5.4–R5.8

const CLASSES: LinkClass[] = ["living", "tombstone", "ghost", "drifted", "zombie", "restless", "sealed"];
const RESURRECTABLE: LinkClass[] = ["tombstone", "ghost", "zombie", "drifted"];

function mk(n: number, cls: LinkClass, snap: boolean): LinkResult {
  return {
    url: `https://a${n}.example/page`,
    cls,
    confidence: 0.9,
    reasons: ["x"],
    redirects: [],
    ms: 1,
    occurrences: [],
    snapshot: snap ? { url: `https://web.archive.org/web/2019/https://a${n}.example/page`, timestamp: "20190101000000", beforeCite: true } : undefined,
  } as unknown as LinkResult;
}

const choiceArb = fc.constantFrom<Choice>("snapshot", "replacement", "keep");
const itemArb = fc.record({ cls: fc.constantFrom(...CLASSES), snap: fc.boolean(), choice: choiceArb, rep: fc.boolean() });

function build(items: Array<{ cls: LinkClass; snap: boolean; choice: Choice; rep: boolean }>) {
  const results = items.map((x, i) => mk(i, x.cls, x.snap));
  const choices: Record<string, Choice> = {};
  const found: Record<string, Found> = {};
  items.forEach((x, i) => {
    choices[results[i].url] = x.choice;
    if (x.rep) found[results[i].url] = { url: `https://a${i}.example/new`, reason: "sitemap", confidence: 0.6 };
  });
  return { results, choices, found };
}

describe("defaultChoice (R5.5)", () => {
  it("is the snapshot for tombstone/ghost/zombie with a snapshot, keep otherwise", () => {
    expect(defaultChoice(mk(1, "tombstone", true))).toBe("snapshot");
    expect(defaultChoice(mk(1, "ghost", true))).toBe("snapshot");
    expect(defaultChoice(mk(1, "zombie", true))).toBe("snapshot");
    expect(defaultChoice(mk(1, "tombstone", false))).toBe("keep");
    expect(defaultChoice(mk(1, "drifted", true))).toBe("keep");
    expect(defaultChoice(mk(1, "living", true))).toBe("keep");
  });
  it("property: never the replacement", () => {
    fc.assert(fc.property(fc.constantFrom(...CLASSES), fc.boolean(), (cls, snap) => {
        expect(defaultChoice(mk(1, cls, snap))).not.toBe("replacement");
      }),
    );
  });
});

describe("replacementMap (R5.8)", () => {
  it("property: keep never maps; keys are resurrectable result URLs; targets match the choice", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 12 }), (items) => {
        const { results, choices, found } = build(items);
        const m = replacementMap(results, choices, found);
        for (const [url, to] of m) {
          const r = results.find((x) => x.url === url)!;
          expect(RESURRECTABLE).toContain(r.cls);
          expect(choices[url]).not.toBe("keep");
          expect(to).toBe(choices[url] === "snapshot" ? r.snapshot!.url : found[url]!.url);
          expect(to).not.toBe(url);
        }
        for (const r of results) {
          if (choices[r.url] === "keep") expect(m.has(r.url)).toBe(false);
          if (choices[r.url] === "snapshot" && !r.snapshot) expect(m.has(r.url)).toBe(false);
          if (choices[r.url] === "replacement" && !found[r.url]) expect(m.has(r.url)).toBe(false);
          if (!RESURRECTABLE.includes(r.cls)) expect(m.has(r.url)).toBe(false);
        }
      }),
    );
  });

  it("a link without a recorded choice is kept", () => {
    const r = mk(1, "tombstone", true);
    expect(replacementMap([r], {}, {}).size).toBe(0);
  });

  it("ignores a replacement equal to the link", () => {
    const r = mk(1, "tombstone", false);
    expect(targetFor(r, "replacement", { url: r.url, reason: "redirect", confidence: 0.9 })).toBeNull();
  });

  it("property: patching with the map changes only the mapped URLs", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { minLength: 1, maxLength: 8 }), (items) => {
        const { results, choices, found } = build(items);
        const src = results.map((r) => `- [t](${r.url})`).join("\n") + "\n";
        const m = replacementMap(results, choices, found);
        const out = patchMarkdown(src, m).content.split("\n");
        results.forEach((r, i) => expect(out[i]).toBe(`- [t](${m.get(r.url) ?? r.url})`));
      }),
    );
  });
});

describe("choiceSummary and reasonText (R5.7)", () => {
  it("splits snapshot and replacement links following the same map", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 12 }), (items) => {
        const { results, choices, found } = build(items);
        const m = replacementMap(results, choices, found);
        const s = choiceSummary(results, choices, found);
        expect(s.snapshot.length + s.replacement.length).toBe(m.size);
        for (const x of s.replacement) expect(m.get(x.r.url)).toBe(x.found.url);
        for (const r of s.snapshot) expect(m.get(r.url)).toBe(r.snapshot!.url);
      }),
    );
  });
  it("names every reason in plain words", () => {
    expect(reasonText("github-rename")).toMatch(/GitHub/);
    expect(reasonText("redirect")).toMatch(/redirect/i);
    expect(reasonText("sitemap")).toMatch(/sitemap/i);
  });
});
