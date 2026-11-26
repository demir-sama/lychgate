import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixError, ghUrl, openFixPullRequest, type FixTransport } from "@/lib/fix/github";

// fix-it R2.1 to R2.15. Fake tokens are built at run time so the secret scan stays green.
const TOKEN = "ghp_" + "a".repeat(36);
const SHA = "a".repeat(40);
const FROM = "https://dead.example/a";
const TO = "https://web.archive.org/web/20190101000000/https://dead.example/a";
const REPLACEMENTS = [{ from: FROM, to: TO }];
const NOW = () => new Date(Date.UTC(2026, 10, 26, 12, 0, 0));
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const REPO = { private: false, archived: false, default_branch: "main", permissions: { push: true } };
const file = (text: string, sha = "blob1") => json({ type: "file", encoding: "base64", content: b64(text), sha, size: text.length });

type Call = { method: string; url: string; path: string; body: any; init: RequestInit };
type Handler = (c: Call) => Response | Promise<Response> | undefined | void;

function fake(handler: Handler, files: Record<string, string | Response> = { "README.md": `See [a](${FROM}).\n` }) {
  const calls: Call[] = [];
  let live = 0;
  let maxLive = 0;
  const transport: FixTransport = async (url, init) => {
    const u = new URL(url);
    const method = String(init.method);
    const call: Call = { method, url, path: u.pathname + u.search, body: init.body ? JSON.parse(String(init.body)) : undefined, init };
    calls.push(call);
    live++;
    maxLive = Math.max(maxLive, live);
    await Promise.resolve();
    try {
      const custom = handler(call);
      if (custom) return await custom;
      if (method === "GET" && u.pathname === "/repos/o/r") return json(REPO);
      if (method === "GET" && u.pathname === "/repos/o/r/git/ref/heads/main") return json({ object: { sha: SHA } });
      if (method === "GET" && u.pathname.startsWith("/repos/o/r/contents/")) {
        const p = decodeURIComponent(u.pathname.slice("/repos/o/r/contents/".length));
        const f = files[p];
        if (f === undefined) return json({ message: "Not Found" }, 404);
        return typeof f === "string" ? file(f) : f;
      }
      if (method === "POST" && u.pathname === "/repos/o/r/git/refs") return json({}, 201);
      if (method === "PUT" && u.pathname.startsWith("/repos/o/r/contents/")) return json({ commit: { sha: "c" } });
      if (method === "POST" && u.pathname === "/repos/o/r/pulls") return json({ html_url: "https://github.com/o/r/pull/7", number: 7 }, 201);
      return json({ message: "unexpected" }, 500);
    } finally {
      live--;
    }
  };
  return { transport, calls, maxLive: () => maxLive };
}

const input = (over: Record<string, unknown> = {}) => ({
  repo: "o/r",
  token: TOKEN,
  replacements: REPLACEMENTS,
  paths: ["README.md"],
  ...over,
});
const deps = (transport: FixTransport, random: () => number = () => 0.5) => ({ transport, now: NOW, random });
const run = (f: ReturnType<typeof fake>, over: Record<string, unknown> = {}) =>
  openFixPullRequest(input(over) as any, deps(f.transport));
const sig = (c: Call) => `${c.method} ${c.path}`;

afterEach(() => vi.restoreAllMocks());

describe("openFixPullRequest happy path (R2.2, R2.8 to R2.10)", () => {
  it("makes exactly the documented calls in order and returns the pull request", async () => {
    const f = fake(() => undefined);
    const res = await run(f);
    const branch = "lychgate/fix-20261126-" + "i".repeat(6); // 0.5 * 36 = 18 -> "i"
    expect(f.calls.map(sig)).toEqual([
      "GET /repos/o/r",
      "GET /repos/o/r/git/ref/heads/main",
      `GET /repos/o/r/contents/README.md?ref=${SHA}`,
      "POST /repos/o/r/git/refs",
      "PUT /repos/o/r/contents/README.md",
      "POST /repos/o/r/pulls",
    ]);
    expect(f.calls[3].body).toEqual({ ref: `refs/heads/${branch}`, sha: SHA });
    const put = f.calls[4].body;
    expect(put.branch).toBe(branch);
    expect(put.sha).toBe("blob1");
    expect(put.message).toBe("Lychgate: resurrect 1 dead link in README.md");
    expect(Buffer.from(put.content, "base64").toString("utf8")).toBe(`See [a](${TO}).\n`);
    expect(f.calls[5].body).toMatchObject({
      title: "Lychgate: resurrect 1 dead link",
      head: branch,
      base: "main",
    });
    expect(f.calls[5].body.body).toContain("Wayback snapshot");
    expect(res).toMatchObject({ url: "https://github.com/o/r/pull/7", number: 7, branch, files: ["README.md"], links: 1, skipped: [] });
  });

  it("writes files one after another and keeps a byte-order mark", async () => {
    const f = fake(() => undefined, {
      "a.md": `\uFEFF[a](${FROM})\r\n`,
      "docs/b.md": `[b](${FROM})`,
    });
    await run(f, { paths: ["a.md", "docs/b.md"] });
    expect(f.maxLive()).toBe(1);
    const puts = f.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.path)).toEqual(["/repos/o/r/contents/a.md", "/repos/o/r/contents/docs/b.md"]);
    const first = Buffer.from(puts[0].body.content, "base64").toString("utf8");
    expect(first).toBe(`\uFEFF[a](${TO})\r\n`);
  });

  it("never writes to the default branch and uses only GET, POST and PUT", async () => {
    const f = fake(() => undefined);
    await run(f);
    expect(new Set(f.calls.map((c) => c.method))).toEqual(new Set(["GET", "POST", "PUT"]));
    for (const c of f.calls) {
      expect(c.url.startsWith("https://api.github.com/")).toBe(true);
      expect(c.init.redirect).toBe("manual");
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.url).not.toContain(TOKEN);
      if (c.method !== "GET") {
        expect(c.body?.ref ?? "").not.toBe("refs/heads/main");
        expect(c.body?.branch ?? "x").not.toBe("main");
      }
    }
  });
});

describe("refusals before any write (R2.4, R2.5, R2.7)", () => {
  it("stops with 403 and a fork hint when the token cannot push", async () => {
    const f = fake((c) => (sig(c) === "GET /repos/o/r" ? json({ ...REPO, permissions: { push: false } }) : undefined));
    const err = await run(f).catch((e) => e);
    expect(err).toBeInstanceOf(FixError);
    expect(err.status).toBe(403);
    expect(err.message.toLowerCase()).toContain("fork");
    expect(f.calls).toHaveLength(1);
  });

  it.each([
    ["private", { private: true }],
    ["archived", { archived: true }],
  ])("refuses a %s repository with 403 and no further call", async (_n, patch) => {
    const f = fake((c) => (sig(c) === "GET /repos/o/r" ? json({ ...REPO, ...patch }) : undefined));
    const err = await run(f).catch((e) => e);
    expect(err.status).toBe(403);
    expect(f.calls).toHaveLength(1);
  });

  it("says Nothing to fix with 422 and makes no write call", async () => {
    const f = fake(() => undefined, { "README.md": "no links here\n" });
    const err = await run(f).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toContain("Nothing to fix");
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("maps 404, 401 and a spent rate limit", async () => {
    const nf = await run(fake((c) => (sig(c) === "GET /repos/o/r" ? json({ message: "Not Found" }, 404) : undefined))).catch((e) => e);
    expect(nf.status).toBe(404);
    expect(nf.message.toLowerCase()).toContain("not found");
    const un = await run(fake((c) => (sig(c) === "GET /repos/o/r" ? json({ message: "Bad credentials" }, 401) : undefined))).catch((e) => e);
    expect(un.status).toBe(401);
    expect(un.message.toLowerCase()).toContain("token");
    const reset = String(Math.floor(Date.UTC(2026, 10, 26, 13, 0, 0) / 1000));
    const rl = await run(
      fake((c) =>
        sig(c) === "GET /repos/o/r"
          ? json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset })
          : undefined,
      ),
    ).catch((e) => e);
    expect(rl.status).toBe(429);
    expect(rl.message).toContain("2026-11-26T13:00:00");
  });

  it("answers 504 when a call times out", async () => {
    const f = fake((c) => {
      if (sig(c) === "GET /repos/o/r") throw new DOMException("timed out", "TimeoutError");
    });
    const err = await run(f).catch((e) => e);
    expect(err.status).toBe(504);
  });
});

describe("reading files (R2.6)", () => {
  it("skips missing, directory, oversized and non-UTF-8 paths and still opens the pull request", async () => {
    const f = fake(() => undefined, {
      "README.md": `[a](${FROM})`,
      "dir.md": json([{ type: "file" }]),
      "big.md": json({ type: "file", encoding: "none", content: "", sha: "s", size: 2_000_000 }),
      "bad.md": json({ type: "file", encoding: "base64", content: Buffer.from([0xff, 0xfe, 0x41]).toString("base64"), sha: "s", size: 3 }),
      "link.md": json({ type: "symlink", target: "x" }),
    });
    const res = await run(f, { paths: ["README.md", "gone.md", "dir.md", "big.md", "bad.md", "link.md"] });
    expect(res.files).toEqual(["README.md"]);
    expect(res.skipped.map((s) => s.path).sort()).toEqual(["bad.md", "big.md", "dir.md", "gone.md", "link.md"]);
    expect(res.skipped.every((s) => typeof s.reason === "string" && s.reason.length > 0)).toBe(true);
  });

  it("reads each file at the head SHA, not the branch name", async () => {
    const f = fake(() => undefined);
    await run(f);
    const get = f.calls.find((c) => c.path.startsWith("/repos/o/r/contents/"))!;
    expect(get.path).toContain(`ref=${SHA}`);
    expect(get.path).not.toContain("main");
  });
});

describe("branch and failures (R2.8, R2.12)", () => {
  it("retries once with a new suffix when the branch already exists", async () => {
    const rolls = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    let i = 0;
    let first = true;
    const f = fake((c) => {
      if (sig(c) === "POST /repos/o/r/git/refs" && first) {
        first = false;
        return json({ message: "Reference already exists" }, 422);
      }
    });
    const res = await openFixPullRequest(input() as any, { transport: f.transport, now: NOW, random: () => rolls[i++ % rolls.length] });
    const refs = f.calls.filter((c) => sig(c) === "POST /repos/o/r/git/refs");
    expect(refs).toHaveLength(2);
    expect(refs[0].body.ref).not.toBe(refs[1].body.ref);
    expect(res.branch).toBe(refs[1].body.ref.replace("refs/heads/", ""));
  });

  it("gives up after one retry", async () => {
    const f = fake((c) => (sig(c) === "POST /repos/o/r/git/refs" ? json({ message: "Reference already exists" }, 422) : undefined));
    const err = await run(f).catch((e) => e);
    expect(err).toBeInstanceOf(FixError);
    expect(f.calls.filter((c) => sig(c) === "POST /repos/o/r/git/refs")).toHaveLength(2);
    expect(f.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("names the branch and the committed files when a later step fails, and deletes nothing", async () => {
    const f = fake(
      (c) => (c.method === "PUT" && c.path.endsWith("/docs/b.md") ? json({ message: "Server Error" }, 500) : undefined),
      { "a.md": `[a](${FROM})`, "docs/b.md": `[b](${FROM})` },
    );
    const err = await run(f, { paths: ["a.md", "docs/b.md"] }).catch((e) => e);
    expect(err).toBeInstanceOf(FixError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("lychgate/fix-20261126-");
    expect(err.message).toContain("a.md");
    expect(f.calls.some((c) => !["GET", "POST", "PUT"].includes(c.method))).toBe(false);
    expect(f.calls.some((c) => c.method === "POST" && c.path.endsWith("/pulls"))).toBe(false);
  });

  it("names the branch when opening the pull request fails", async () => {
    const f = fake((c) => (sig(c) === "POST /repos/o/r/pulls" ? json({ message: "Validation Failed" }, 422) : undefined));
    const err = await run(f).catch((e) => e);
    expect(err.message).toContain("lychgate/fix-20261126-");
  });
});

describe("transport rules (R2.1, R2.3, R2.14)", () => {
  it.each([301, 302, 307, 308])("does not follow a %i and says the repository moved", async (status) => {
    const f = fake((c) =>
      sig(c) === "GET /repos/o/r"
        ? new Response(null, { status, headers: { location: "https://evil.example/steal" } })
        : undefined,
    );
    const err = await run(f).catch((e) => e);
    expect(err).toBeInstanceOf(FixError);
    expect(err.message.toLowerCase()).toContain("moved");
    expect(f.calls).toHaveLength(1);
  });

  it("ghUrl accepts only paths that stay on https://api.github.com", () => {
    expect(ghUrl("/repos/o/r")).toBe("https://api.github.com/repos/o/r");
    expect(() => ghUrl("@evil.example/x")).toThrow();
    expect(() => ghUrl("evil.example/x")).toThrow();
    expect(() => ghUrl("/\\@evil.example")).not.toThrow(); // stays on api.github.com
    fc.assert(
      fc.property(fc.string(), (p) => {
        try {
          return new URL(ghUrl(p)).origin === "https://api.github.com";
        } catch {
          return true; // refused is fine; a different origin is not
        }
      }),
    );
  });
});

describe("the token never leaks (R2.15)", () => {
  it("is absent from errors, results and console output, even when GitHub echoes it", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const echo = json({ message: `Bad credentials for ${TOKEN} and ghp_${"z".repeat(30)}` }, 401);
    const bad = await run(fake((c) => (sig(c) === "GET /repos/o/r" ? echo.clone() : undefined))).catch((e) => e);
    expect(bad.message).not.toContain(TOKEN);
    expect(bad.message).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(JSON.stringify({ ...bad, message: bad.message, stack: bad.stack })).not.toContain(TOKEN);

    const thrown = await run(
      fake((c) => {
        if (sig(c) === "GET /repos/o/r") throw new Error(`socket hang up ${TOKEN}`);
      }),
    ).catch((e) => e);
    expect(thrown).toBeInstanceOf(FixError);
    expect(thrown.message).not.toContain(TOKEN);

    const late = await run(
      fake((c) => (c.method === "PUT" ? json({ message: `nope ${TOKEN}` }, 500) : undefined)),
    ).catch((e) => e);
    expect(late.message).not.toContain(TOKEN);

    const ok = await run(fake(() => undefined));
    expect(JSON.stringify(ok)).not.toContain(TOKEN);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("does not repeat more of a GitHub body than its message field", async () => {
    const f = fake((c) =>
      sig(c) === "GET /repos/o/r" ? json({ message: "Boom", documentation_url: "https://docs.example/secret-detail", extra: "LEAK" }, 500) : undefined,
    );
    const err = await run(f).catch((e) => e);
    expect(err.message).not.toContain("LEAK");
    expect(err.message).not.toContain("secret-detail");
    expect(err.message).toContain("Boom");
  });
});
