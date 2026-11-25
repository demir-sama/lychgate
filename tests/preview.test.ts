import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { framedSnapshotUrl, patchPreview } from "@/lib/patch/preview";
import { VOICES, shouldPlay } from "@/lib/sound/sound";

describe("séance preview (resurrection-engine task 5)", () => {
  it("frames snapshots in toolbar-less if_ mode", () => {
    expect(framedSnapshotUrl("https://web.archive.org/web/20190501000000/https://a.example/x")).toBe("https://web.archive.org/web/20190501000000if_/https://a.example/x");
    expect(framedSnapshotUrl("https://web.archive.org/web/20190501000000id_/https://a.example/x")).toBe("https://web.archive.org/web/20190501000000if_/https://a.example/x");
  });

  it("shows only lines that cite the link, before and after", () => {
    const docs = [{ path: "README.md", content: "# T\n- [a](https://a.example/x) and [b](https://b.example/)\n- [c](https://c.example/)\n" }];
    const out = patchPreview(docs, { url: "https://a.example/x", occurrences: [{ doc: "README.md", line: 2 }] }, "https://web.archive.org/web/2019/https://a.example/x");
    expect(out).toHaveLength(1);
    expect(out[0].where).toBe("README.md:2");
    expect(out[0].after).toContain("(https://web.archive.org/web/2019/https://a.example/x)");
    expect(out[0].after).toContain("(https://b.example/)");
  });

  it("property: the preview never touches other URLs on the line", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 5 }), (paths) => {
        const others = paths.map((p) => `[${p}](https://other.example/${p})`).join(" ");
        const line = `${others} [t](https://dead.example/page)`;
        const out = patchPreview([{ path: "a.md", content: line }], { url: "https://dead.example/page", occurrences: [{ doc: "a.md", line: 1 }] }, "https://web.archive.org/web/2020/https://dead.example/page");
        expect(out).toHaveLength(1);
        for (const p of paths) expect(out[0].after).toContain(`(https://other.example/${p})`);
      }),
    );
  });
});

describe("sound design (graveyard-ui R6.3)", () => {
  it("every link class has its own voice", () => {
    for (const k of ["living", "tombstone", "ghost", "drifted", "zombie", "restless", "sealed", "open", "done", "resurrect"] as const) {
      expect(VOICES[k].freqs.length).toBeGreaterThan(0);
      expect(VOICES[k].gain).toBeLessThanOrEqual(0.1);
    }
  });
  it("throttles bursts", () => {
    expect(shouldPlay(0, 100)).toBe(false);
    expect(shouldPlay(0, 140)).toBe(true);
  });
});
