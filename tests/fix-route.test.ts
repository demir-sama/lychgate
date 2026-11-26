import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
vi.mock("@/lib/fix/github", async (orig) => ({
  ...(await orig<typeof import("@/lib/fix/github")>()),
  openFixPullRequest: (...a: unknown[]) => open(...a),
}));

import { POST, maxDuration } from "@/app/api/fix/route";
import { FixError } from "@/lib/fix/github";

const ORIGIN = "https://lychgate.test";
const TOKEN = "ghp_" + "a".repeat(36);
const good = () => ({
  repo: "octo/cat",
  token: TOKEN,
  replacements: [{ from: "https://old.example/a", to: "https://web.archive.org/web/2019/https://old.example/a" }],
  paths: ["README.md"],
});
type Opts = { ip?: string; origin?: string | null; length?: string | null };
const req = (body: unknown, opts: Opts = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.80" };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (opts.length) headers["content-length"] = opts.length;
  return new Request(`${ORIGIN}/api/fix`, { method: "POST", headers, body: text });
};
const ok = { url: "https://github.com/octo/cat/pull/7", number: 7, branch: "lychgate/fix-20261126-abc123", files: ["README.md"], links: 1, skipped: [] };

let spies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  open.mockReset();
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  for (const s of spies) expect(s).not.toHaveBeenCalled(); // R3.8
  vi.restoreAllMocks();
});

const headersOk = (res: Response) => {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
};

describe("POST /api/fix", () => {
  it("opens the pull request and answers 200 (R3.5, R3.6, R3.7)", async () => {
    open.mockResolvedValue(ok);
    const res = await POST(req(good(), { ip: "198.51.100.1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ok);
    headersOk(res);
    expect(open.mock.calls[0][0]).toEqual(good());
    expect(open.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(maxDuration).toBe(30);
  });

  it("refuses other origins with 403 before reading the body (R3.1)", async () => {
    const r = req(good(), { ip: "198.51.100.2", origin: "https://evil.test" });
    const res = await POST(r);
    expect(res.status).toBe(403);
    expect(r.bodyUsed).toBe(false);
    headersOk(res);
    expect(open).not.toHaveBeenCalled();
  });

  it("allows 5 per IP then 429 with Retry-After, in its own bucket (R3.2, R3.9)", async () => {
    open.mockResolvedValue(ok);
    const statuses: number[] = [];
    let sixth: Response | undefined;
    for (let i = 0; i < 6; i++) {
      // a different token each time: the limiter key must be the IP only
      const body = { ...good(), token: "ghp_" + String(i).repeat(36) };
      sixth = await POST(req(body, { ip: "198.51.100.3" }));
      statuses.push(sixth.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(Number(sixth!.headers.get("retry-after"))).toBeGreaterThan(0);
    headersOk(sixth!);
    expect((await POST(req(good(), { ip: "198.51.100.4" }))).status).toBe(200);
  });

  it("refuses a large body by Content-Length and by bytes read, without parsing (R3.3)", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const byHeader = await POST(req(good(), { ip: "198.51.100.5", length: String(64 * 1024 + 1) }));
    expect(byHeader.status).toBe(413);
    headersOk(byHeader);
    const big = JSON.stringify({ ...good(), pad: "x".repeat(70 * 1024) });
    const byBytes = await POST(req(big, { ip: "198.51.100.6" }));
    expect(byBytes.status).toBe(413);
    // a lying, small Content-Length does not help
    const lying = await POST(req(big, { ip: "198.51.100.7", length: "10" }));
    expect(lying.status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("answers 400 for bad bodies and never echoes the token (R3.4)", async () => {
    const secret = "ghp_" + "Z".repeat(30) + " has space";
    const cases: unknown[] = [
      "not json",
      {},
      { ...good(), token: secret },
      { ...good(), token: "short" },
      { ...good(), repo: "https://github.com/octo/cat" },
      { ...good(), replacements: [] },
      { ...good(), paths: ["../x.md"] },
      { ...good(), extra: 1 },
    ];
    let n = 0;
    for (const c of cases) {
      const res = await POST(req(c as never, { ip: `192.0.2.${100 + n++}` }));
      expect(res.status).toBe(400);
      headersOk(res);
      const text = await res.text();
      expect(text).not.toContain(secret);
      expect(text).not.toContain("Z".repeat(30));
      expect(JSON.parse(text).error).toEqual(expect.any(String));
    }
    const tokenIssue = await (await POST(req({ ...good(), token: secret }, { ip: "192.0.2.200" }))).json();
    expect(tokenIssue.error).toMatch(/token/);
    expect(open).not.toHaveBeenCalled();
  });

  it("maps writer failures to their status with JSON { error } (R3.5)", async () => {
    for (const status of [401, 403, 404, 422, 429, 502, 504]) {
      open.mockRejectedValueOnce(new FixError(status, `message ${status}`));
      const res = await POST(req(good(), { ip: `198.51.100.${20 + status % 50}` }));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: `message ${status}` });
      headersOk(res);
    }
  });

  it("turns an unexpected failure into a static 502 without the token (R3.8)", async () => {
    open.mockRejectedValueOnce(new Error(`boom ${TOKEN}`));
    const res = await POST(req(good(), { ip: "198.51.100.90" }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    headersOk(res);
  });

  it("redacts a token that a writer message carries (R3.8)", async () => {
    open.mockRejectedValueOnce(new FixError(502, `GitHub said ${TOKEN}`));
    const res = await POST(req(good(), { ip: "198.51.100.91" }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("does not put the token in the response of a success (R3.9)", async () => {
    open.mockResolvedValue(ok);
    const res = await POST(req(good(), { ip: "198.51.100.92" }));
    expect(await res.text()).not.toContain(TOKEN);
  });
});
