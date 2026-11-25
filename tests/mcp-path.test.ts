import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readInsideCwd } from "../packages/lychgate-mcp/src/tools";

// Layout: <base>/outside/secret.md (not allowed), <base>/work/{ok.md, sub/in.md, link -> ../outside, flink -> ../outside/secret.md}
const base = realpathSync(mkdtempSync(join(tmpdir(), "lychgate-path-")));
const work = join(base, "work");
const outside = join(base, "outside");
mkdirSync(join(work, "sub"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(outside, "secret.md"), "SECRET");
writeFileSync(join(work, "ok.md"), "OK");
writeFileSync(join(work, "sub", "in.md"), "IN");
symlinkSync(outside, join(work, "link"));
symlinkSync(join(outside, "secret.md"), join(work, "flink.md"));

const seg = fc.oneof(
  fc.constantFrom("..", ".", "sub", "link", "work", "outside", "secret.md", "ok.md", "in.md", "flink.md", ""),
  fc.string({ maxLength: 6 }),
);

describe("mcp path sandbox (R3.2)", () => {
  it("never returns content from outside the working directory", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(seg, { minLength: 1, maxLength: 6 }), fc.boolean(), async (segs, abs) => {
        const p = (abs ? join(base, ...segs) : segs.join("/")) || "x";
        try {
          const r = await readInsideCwd(p, work);
          expect(r.text).not.toContain("SECRET");
          expect(r.rel.startsWith("..")).toBe(false);
          expect(r.rel.startsWith("/")).toBe(false);
        } catch {
          /* refusing is always allowed */
        }
      }),
      { numRuns: 300 },
    );
  });

  it("refuses ../, absolute outside paths and symlinks that leave cwd", async () => {
    for (const p of ["../outside/secret.md", join(outside, "secret.md"), "link/secret.md", "flink.md", "sub/../../outside/secret.md"]) {
      await expect(readInsideCwd(p, work)).rejects.toThrow(/outside/i);
    }
  });

  it("still reads files inside cwd", async () => {
    expect((await readInsideCwd("ok.md", work)).text).toBe("OK");
    expect(await readInsideCwd("sub/../sub/in.md", work)).toEqual({ rel: "sub/in.md", text: "IN" });
    expect((await readInsideCwd(join(work, "ok.md"), work)).rel).toBe("ok.md");
  });
});
