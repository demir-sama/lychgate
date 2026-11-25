import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const suggest = vi.fn();
// vitest 5 reports an error thrown inside a vi.fn as a test failure even when the caller handles it,
// so the failure case throws from a plain function instead.
let failWith: Error | null = null;
vi.mock("@/lib/patch/replacement", async (orig) => ({
  ...(await orig<typeof import("@/lib/patch/replacement")>()),
  suggestReplacement: (...a: unknown[]) => {
    if (failWith) throw failWith;
    return suggest(...a);
  },
}));

import { POST } from "@/app/api/replacement/route";
import { isSameOrigin } from "@/lib/util/sameorigin";

const ORIGIN = "https://lychgate.test";
const req = (body: unknown, opts: { ip?: string; origin?: string | null; site?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.70" };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  if (opts.site) headers["sec-fetch-site"] = opts.site;
  return new Request(`${ORIGIN}/api/replacement`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
};

beforeEach(() => {
  suggest.mockReset();
  failWith = null;
});
afterEach(() => vi.restoreAllMocks());

describe("isSameOrigin (R4.12)", () => {
  it("accepts a matching Origin, or no Origin with Sec-Fetch-Site same-origin", () => {
    expect(isSameOrigin(req({}))).toBe(true);
    expect(isSameOrigin(req({}, { origin: null, site: "same-origin" }))).toBe(true);
  });
  it("refuses another origin, cross-site fetches and requests with no browser signal", () => {
    expect(isSameOrigin(req({}, { origin: "https://evil.test" }))).toBe(false);
    expect(isSameOrigin(req({}, { origin: "null" }))).toBe(false);
    expect(isSameOrigin(req({}, { origin: null, site: "cross-site" }))).toBe(false);
    expect(isSameOrigin(req({}, { origin: null }))).toBe(false);
  });
});

describe("POST /api/replacement (R4.12)", () => {
  it("answers with the replacement and passes a 15 s abort signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    suggest.mockResolvedValue({ url: "https://a.example/new", reason: "redirect", confidence: 0.9 });
    const res = await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.10" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replacement: { url: "https://a.example/new", reason: "redirect", confidence: 0.9 }, timedOut: false });
    expect(suggest.mock.calls[0][0]).toBe("https://a.example/old");
    expect(suggest.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers null when there is nothing to suggest", async () => {
    suggest.mockResolvedValue(null);
    const res = await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.11" }));
    expect(await res.json()).toEqual({ replacement: null, timedOut: false });
  });

  it("reports timedOut when the budget ran out", async () => {
    suggest.mockResolvedValue(null);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    const res = await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.12" }));
    expect((await res.json()).timedOut).toBe(true);
  });

  it("validates the body", async () => {
    expect((await POST(req("not json", { ip: "198.51.100.13" }))).status).toBe(400);
    for (const bad of [{}, { url: "" }, { url: "ftp://a.example/x" }, { url: "nonsense" }, { url: 5 }, { url: `https://a.example/${"x".repeat(3000)}` }]) {
      const res = await POST(req(bad, { ip: "198.51.100.14" }));
      expect(res.status).toBe(400);
    }
    expect(suggest).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests before doing any work", async () => {
    const res = await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.15", origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("rate limits per IP in its own bucket (R5.9: 30 per 10 minutes, user-triggered per link)", async () => {
    suggest.mockResolvedValue(null);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.99" }))).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    // another IP is unaffected
    expect((await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.98" }))).status).toBe(200);
  });

  it("turns an unexpected failure into a 500 with a plain message", async () => {
    failWith = new Error("boom");
    const res = await POST(req({ url: "https://a.example/old" }, { ip: "198.51.100.16" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/replacement/i);
  });
});
