import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { redactToken, safeMessage } from "@/lib/fix/redact";

// fix-it R1.10, R1.11. Fake tokens are built at run time so the secret scan stays green.
const word = fc.stringMatching(/^[A-Za-z0-9_]{20,60}$/);
const shaped = fc.oneof(
  word.map((w) => "ghp_" + w),
  word.map((w) => "gho_" + w),
  word.map((w) => "ghu_" + w),
  word.map((w) => "ghs_" + w),
  word.map((w) => "ghr_" + w),
  word.map((w) => "github_pat_" + w),
);
const SHAPE = /gh[pousr]_\w{20,}|github_pat_\w{20,}/;

describe("redactToken (R1.10)", () => {
  it("removes the given token wherever it occurs", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), fc.array(fc.string({ maxLength: 20 }), { maxLength: 6 }), (token, parts) => {
        const text = parts.join(token);
        const out = redactToken(text, token);
        expect(out.split("[redacted]").every((seg) => !seg.includes(token))).toBe(true);
        if (text.includes(token) && !text.includes("[redacted]")) expect(out).toContain("[redacted]");
      }),
    );
  });

  it("removes token-shaped strings without being told the token", () => {
    fc.assert(
      fc.property(shaped, fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), (t, a, b) => {
        const out = redactToken(`${a} ${t} ${b}`);
        expect(SHAPE.test(out)).toBe(false);
        expect(out).toContain("[redacted]");
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.option(fc.string({ maxLength: 12 }), { nil: undefined }), (text, token) => {
        const once = redactToken(text, token);
        expect(redactToken(once, token)).toBe(once);
      }),
    );
    fc.assert(
      fc.property(shaped, fc.string({ maxLength: 20 }), (t, a) => {
        const once = redactToken(`${a}${t}${a}`, t);
        expect(redactToken(once, t)).toBe(once);
      }),
    );
  });

  it("never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (text, token) => {
        expect(() => redactToken(text as never, token as never)).not.toThrow();
        expect(typeof redactToken(text as never, token as never)).toBe("string");
      }),
    );
  });

  it("keeps text without a token unchanged", () => {
    expect(redactToken("repository not found", "ghp_" + "a".repeat(36))).toBe("repository not found");
    expect(redactToken("no token here")).toBe("no token here");
  });

  it("an empty token removes nothing", () => {
    expect(redactToken("abc", "")).toBe("abc");
  });
});

describe("safeMessage (R1.11)", () => {
  it("never carries the token, from an Error, a string or an object", () => {
    fc.assert(
      fc.property(word, fc.string({ maxLength: 40 }), (w, pad) => {
        const token = "ghp_" + w;
        for (const err of [new Error(`${pad} bad ${token} ${pad}`), `${pad}${token}`, { message: `x ${token}` }, new TypeError(token)]) {
          const m = safeMessage(err, token);
          expect(m.includes(token)).toBe(false);
          expect(SHAPE.test(m)).toBe(false);
        }
      }),
    );
  });

  it("is at most 300 characters", () => {
    fc.assert(fc.property(fc.string({ maxLength: 2000 }), (s) => {
        expect(safeMessage(new Error(s), "x".repeat(25)).length).toBeLessThanOrEqual(300);
      }));
  });

  it("never throws on odd values and always returns text", () => {
    const evil = { get message(): string { throw new Error("boom"); } };
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const v of [undefined, null, 42, Symbol("s"), evil, circular, Object.create(null)]) {
      expect(() => safeMessage(v, "t".repeat(25))).not.toThrow();
      expect(safeMessage(v, "t".repeat(25)).length).toBeGreaterThan(0);
    }
    fc.assert(fc.property(fc.anything(), (v) => {
        expect(safeMessage(v, undefined as never).length).toBeLessThanOrEqual(300);
      }));
  });

  it("keeps a short plain message readable", () => {
    expect(safeMessage(new Error("Repository not found."), "ghp_" + "a".repeat(36))).toBe("Repository not found.");
  });
});
