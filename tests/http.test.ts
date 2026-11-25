import http from "node:http";
import type { AddressInfo } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGuardedLookup, SsrfError } from "@/lib/fetch/guard";
import { classifyError, FetchFailure, probeLink, safeFetch, USER_AGENT } from "@/lib/fetch/http";
import { html, mockResolver, mockTransport, redirect } from "./helpers";

describe("safeFetch redirect handling", () => {
  it("follows redirects and records hops", async () => {
    const t = mockTransport({
      "https://a.example/start": redirect("/middle", 301),
      "https://a.example/middle": redirect("https://b.example/end"),
      "https://b.example/end": html("hi"),
    });
    const r = await safeFetch("https://a.example/start", { transport: t, resolver: mockResolver() });
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe("https://b.example/end");
    expect(r.redirects).toEqual([
      { from: "https://a.example/start", to: "https://a.example/middle", status: 301 },
      { from: "https://a.example/middle", to: "https://b.example/end", status: 302 },
    ]);
  });

  it("re-checks every hop: redirect to a private IP literal is refused before connecting", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const t = mockTransport({ "https://a.example/": redirect("http://169.254.169.254/latest/meta-data/") }, calls);
    const err = await safeFetch("https://a.example/", { transport: t, resolver: mockResolver() }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("ssrf");
    expect(err.redirects).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual(["https://a.example/"]);
  });

  it("re-checks every hop: redirect to a hostname that resolves privately is refused", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const t = mockTransport({ "https://a.example/": redirect("https://internal.example/admin") }, calls);
    const err = await safeFetch("https://a.example/", { transport: t, resolver: mockResolver({ "internal.example": ["10.0.0.7"] }) }).catch((e) => e);
    expect(err.kind).toBe("ssrf");
    expect(calls).toHaveLength(1);
  });

  it("refuses redirects to other schemes and ports", async () => {
    for (const loc of ["file:///etc/passwd", "gopher://a.example/", "http://a.example:6379/"]) {
      const t = mockTransport({ "https://a.example/": redirect(loc) });
      const err = await safeFetch("https://a.example/", { transport: t, resolver: mockResolver() }).catch((e) => e);
      expect(err.kind).toBe("ssrf");
    }
  });

  it("caps redirects", async () => {
    const t = mockTransport({ "https://loop.example/*": (u) => redirect(`/${Number(u.pathname.slice(1) || 0) + 1}`) });
    const err = await safeFetch("https://loop.example/0", { transport: t, resolver: mockResolver(), maxRedirects: 3 }).catch((e) => e);
    expect(err.kind).toBe("too_many_redirects");
    expect(err.redirects).toHaveLength(3);
  });

  it("treats a 3xx without Location as final", async () => {
    const t = mockTransport({ "https://a.example/": 304 });
    const r = await safeFetch("https://a.example/", { transport: t, resolver: mockResolver() });
    expect(r.status).toBe(304);
  });

  it("refuses the initial URL when DNS points inside", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const err = await safeFetch("https://evil.example/", { transport: mockTransport({}, calls), resolver: mockResolver({ "evil.example": ["127.0.0.1"] }) }).catch((e) => e);
    expect(err.kind).toBe("ssrf");
    expect(calls).toHaveLength(0);
  });

  it("reports DNS failures as kind dns", async () => {
    const err = await safeFetch("https://gone.example/", { transport: mockTransport({}), resolver: mockResolver({ "gone.example": null }) }).catch((e) => e);
    expect(err.kind).toBe("dns");
    expect(err.code).toBe("ENOTFOUND");
  });

  it("sends the polite user agent and custom headers", async () => {
    let ua = "";
    let extra = "";
    const t = mockTransport({
      "https://a.example/": (_u, init) => {
        ua = init.headers["user-agent"];
        extra = init.headers["x-test"];
        return html("ok");
      },
    });
    await safeFetch("https://a.example/", { transport: t, resolver: mockResolver(), headers: { "x-test": "1" } });
    expect(ua).toBe(USER_AGENT);
    expect(extra).toBe("1");
  });

  it("caps the body size", async () => {
    const big = "x".repeat(10_000);
    const t = mockTransport({ "https://a.example/": new Response(big, { headers: { "content-type": "text/plain" } }) });
    const r = await safeFetch("https://a.example/", { transport: t, resolver: mockResolver(), readBody: true, maxBytes: 1000 });
    expect(r.body).toHaveLength(1000);
    expect(r.truncated).toBe(true);
  });

  it("times out slow servers", async () => {
    const t = mockTransport({
      "https://slow.example/": (_u, init) =>
        new Promise<Response>((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    });
    const err = await safeFetch("https://slow.example/", { transport: t, resolver: mockResolver(), timeoutMs: 50 }).catch((e) => e);
    expect(err.kind).toBe("timeout");
  });

  it("rejects invalid Location headers", async () => {
    const t = mockTransport({ "https://a.example/": redirect("http://[bad") });
    const err = await safeFetch("https://a.example/", { transport: t, resolver: mockResolver() }).catch((e) => e);
    expect(err.kind).toBe("invalid");
  });
});

describe("classifyError", () => {
  it("maps undici/node error shapes", () => {
    const wrap = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
    expect(classifyError(wrap("ENOTFOUND")).kind).toBe("dns");
    expect(classifyError(wrap("UND_ERR_CONNECT_TIMEOUT")).kind).toBe("timeout");
    expect(classifyError(wrap("CERT_HAS_EXPIRED")).kind).toBe("tls");
    expect(classifyError(wrap("ERR_TLS_CERT_ALTNAME_INVALID")).kind).toBe("tls");
    expect(classifyError(wrap("ECONNREFUSED")).kind).toBe("connection");
    expect(classifyError(Object.assign(new TypeError("fetch failed"), { cause: new SsrfError("nope") })).kind).toBe("ssrf");
    expect(classifyError(Object.assign(new Error("x"), { name: "AbortError" })).kind).toBe("aborted");
  });
});

describe("probeLink (HEAD → GET fallback)", () => {
  it("uses HEAD only for healthy non-HTML", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const t = mockTransport({ "https://a.example/file.pdf": new Response(null, { status: 200, headers: { "content-type": "application/pdf" } }) }, calls);
    const r = await probeLink("https://a.example/file.pdf", { transport: t, resolver: mockResolver(), wantBody: true });
    expect(r).toMatchObject({ ok: true, method: "HEAD", status: 200 });
    expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
  });
  it("falls back to GET when HEAD is not allowed", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const t = mockTransport({ "https://a.example/": (_u, init) => (init.method === "HEAD" ? new Response(null, { status: 405 }) : html("hello")) }, calls);
    const r = await probeLink("https://a.example/", { transport: t, resolver: mockResolver(), wantBody: true });
    expect(r).toMatchObject({ ok: true, method: "GET", status: 200 });
    expect(r.body).toContain("hello");
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "GET"]);
  });
  it("GETs HTML for content analysis even when HEAD succeeds", async () => {
    const t = mockTransport({ "https://a.example/": html("content") });
    const r = await probeLink("https://a.example/", { transport: t, resolver: mockResolver(), wantBody: true });
    expect(r.method).toBe("GET");
    expect(r.body).toContain("content");
  });
  it("retries with GET when HEAD errors", async () => {
    const t = mockTransport({
      "https://a.example/": (_u, init) => {
        if (init.method === "HEAD") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        return html("ok");
      },
    });
    expect((await probeLink("https://a.example/", { transport: t, resolver: mockResolver(), wantBody: true })).ok).toBe(true);
  });
  it("does not retry SSRF or DNS failures with GET", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const r1 = await probeLink("https://evil.example/", { transport: mockTransport({}, calls), resolver: mockResolver({ "evil.example": ["10.0.0.1"] }) });
    const r2 = await probeLink("https://gone.example/", { transport: mockTransport({}, calls), resolver: mockResolver({ "gone.example": null }) });
    expect(r1.error?.kind).toBe("ssrf");
    expect(r2.error?.kind).toBe("dns");
    expect(calls).toHaveLength(0);
  });
  it("reports a 404 after the GET fallback", async () => {
    const r = await probeLink("https://a.example/missing", { transport: mockTransport({}), resolver: mockResolver(), wantBody: true });
    expect(r).toMatchObject({ ok: false, status: 404, method: "GET" });
  });
});

describe("guarded undici agent (real sockets)", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("secret internal data"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("refuses to connect when a public-looking hostname rebinds to 127.0.0.1 at connect time", async () => {
    const agent = new Agent({ connect: { lookup: createGuardedLookup(mockResolver({ "rebind.example": ["127.0.0.1"] })) as never } });
    const err = await undiciFetch(`http://rebind.example:${port}/`, { dispatcher: agent }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(classifyError(err).kind).toBe("ssrf");
    await agent.close();
  });

  it("sanity: the same server IS reachable without the guard (so the block above is the guard's doing)", async () => {
    const plainLookup = (_h: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) =>
      o?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
    const agent = new Agent({ connect: { lookup: plainLookup as never } });
    const res = await undiciFetch(`http://rebind.example:${port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("secret internal data");
    await agent.close();
  });

  it("safeFetch with the default transport never reaches a loopback literal", async () => {
    const err = await safeFetch(`http://127.0.0.1:8080/`).catch((e) => e);
    expect(err.kind).toBe("ssrf");
  });
});

describe("meta refresh stubs", () => {
  it("metaRefreshTarget parses absolute and relative targets", async () => {
    const { metaRefreshTarget } = await import("@/lib/fetch/http");
    expect(metaRefreshTarget(`<meta http-equiv="refresh" content="0; url=https://new.example/x">`, "http://old.example/")).toBe("https://new.example/x");
    expect(metaRefreshTarget(`<META HTTP-EQUIV=REFRESH CONTENT="5;URL='/moved'">`, "https://a.example/p")).toBe("https://a.example/moved");
    expect(metaRefreshTarget(`<meta http-equiv="refresh" content="30">`, "https://a.example/")).toBeNull();
    expect(metaRefreshTarget(`<p>no tag</p>`, "https://a.example/")).toBeNull();
    expect(metaRefreshTarget(`<meta http-equiv="refresh" content="0; url=https://a.example/">`, "https://a.example/")).toBeNull();
  });
  it("probeLink follows one meta-refresh stub and records the hop", async () => {
    const t = mockTransport({
      "http://stub.example/page": html(`<meta http-equiv="refresh" content="0; url=https://stub.example/page">`, "Moved"),
      "https://stub.example/page": html("<p>real content</p>", "Real"),
    });
    const r = await probeLink("http://stub.example/page", { transport: t, resolver: mockResolver(), wantBody: true });
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: "https://stub.example/page" });
    expect(r.body).toContain("real content");
    expect(r.redirects).toEqual([{ from: "http://stub.example/page", to: "https://stub.example/page", status: 200 }]);
  });
  it("re-checks the meta-refresh target with the SSRF guard", async () => {
    const t = mockTransport({ "https://evil.example/": html(`<meta http-equiv="refresh" content="0; url=http://169.254.169.254/">`) });
    const r = await probeLink("https://evil.example/", { transport: t, resolver: mockResolver(), wantBody: true });
    expect(r.error?.kind).toBe("ssrf");
    expect(r.redirects).toHaveLength(1);
  });
});
