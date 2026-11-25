import { describe, expect, it } from "vitest";
import { assertPublicUrl, assertSafeUrlShape, createGuardedLookup, DnsError, resolvePublic, SsrfError } from "@/lib/fetch/guard";
import { mockResolver, PUBLIC_IP } from "./helpers";

describe("assertSafeUrlShape", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/",
    "gopher://example.com/",
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://user:pass@example.com/",
    "http://example.com:22/",
    "http://example.com:6379/",
    "http://localhost/",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://db.internal/",
    "http://intranet/",
    "http://127.0.0.1/",
    "http://2130706433/", // decimal 127.0.0.1, normalised by the URL parser
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
    "http://127.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fd00:ec2::254]/",
    "not a url",
  ])("refuses %s", (u) => {
    expect(() => assertSafeUrlShape(u)).toThrow(SsrfError);
  });

  it.each(["https://example.com/", "http://example.com:8080/x", "https://example.com:443/", "https://8.8.8.8/", "https://[2606:4700:4700::1111]/"])("accepts %s", (u) => {
    expect(assertSafeUrlShape(u).href).toBeTruthy();
  });
});

describe("resolvePublic", () => {
  it("passes when all records are public", async () => {
    await expect(resolvePublic("example.com", mockResolver())).resolves.toEqual([{ address: PUBLIC_IP, family: 4 }]);
  });
  it("blocks if ANY record is private (mixed answers / rebinding)", async () => {
    const r = mockResolver({ "rebind.example": [PUBLIC_IP, "10.0.0.5"] });
    await expect(resolvePublic("rebind.example", r)).rejects.toBeInstanceOf(SsrfError);
  });
  it("blocks hosts that resolve to metadata / loopback / v6 private", async () => {
    for (const ip of ["169.254.169.254", "127.0.0.1", "::1", "fd00::1", "::ffff:192.168.0.1"]) {
      await expect(resolvePublic("evil.example", mockResolver({ "evil.example": [ip] }))).rejects.toBeInstanceOf(SsrfError);
    }
  });
  it("maps resolver failures to DnsError with the code", async () => {
    const err = await resolvePublic("gone.example", mockResolver({ "gone.example": null })).catch((e) => e);
    expect(err).toBeInstanceOf(DnsError);
    expect(err.code).toBe("ENOTFOUND");
  });
  it("treats an empty answer as DNS failure", async () => {
    await expect(resolvePublic("empty.example", mockResolver({ "empty.example": [] }))).rejects.toBeInstanceOf(DnsError);
  });
  it("checks IP literals without DNS", async () => {
    await expect(resolvePublic("[::1]", mockResolver())).rejects.toBeInstanceOf(SsrfError);
    await expect(resolvePublic("8.8.8.8", mockResolver())).resolves.toHaveLength(1);
  });
});

describe("assertPublicUrl", () => {
  it("combines shape and DNS checks", async () => {
    await expect(assertPublicUrl("https://ok.example/", mockResolver())).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("https://bad.example/", mockResolver({ "bad.example": ["192.168.1.1"] }))).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("ftp://ok.example/", mockResolver())).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("createGuardedLookup (connect-time check)", () => {
  const call = (lookup: ReturnType<typeof createGuardedLookup>, host: string, opts: unknown) =>
    new Promise<{ err: NodeJS.ErrnoException | null; addr: unknown; family?: number }>((resolve) => {
      lookup(host, opts, (err, addr, family) => resolve({ err, addr, family }));
    });

  it("returns a single address in dns.lookup style", async () => {
    const r = await call(createGuardedLookup(mockResolver()), "example.com", {});
    expect(r.err).toBeNull();
    expect(r.addr).toBe(PUBLIC_IP);
    expect(r.family).toBe(4);
  });
  it("supports {all:true}", async () => {
    const r = await call(createGuardedLookup(mockResolver({ "dual.example": [PUBLIC_IP, "2606:4700:4700::1111"] })), "dual.example", { all: true });
    expect(r.addr).toEqual([
      { address: PUBLIC_IP, family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });
  it("honours a family filter, numeric or object", async () => {
    const lk = createGuardedLookup(mockResolver({ "dual.example": [PUBLIC_IP, "2606:4700:4700::1111"] }));
    expect((await call(lk, "dual.example", { family: 6 })).addr).toBe("2606:4700:4700::1111");
    expect((await call(lk, "dual.example", 4)).addr).toBe(PUBLIC_IP);
  });
  it("supports the (host, callback) signature", async () => {
    const lk = createGuardedLookup(mockResolver());
    const r = await new Promise<unknown>((resolve) => (lk as unknown as (h: string, cb: (e: unknown, a: unknown) => void) => void)("example.com", (_e, a) => resolve(a)));
    expect(r).toBe(PUBLIC_IP);
  });
  it("errors (code SSRF_BLOCKED) when the host rebinds to a private address", async () => {
    const r = await call(createGuardedLookup(mockResolver({ "rebind.example": ["127.0.0.1"] })), "rebind.example", {});
    expect(r.err).toBeInstanceOf(SsrfError);
    expect(r.err?.code).toBe("SSRF_BLOCKED");
  });
  it("propagates DNS errors", async () => {
    const r = await call(createGuardedLookup(mockResolver({ "gone.example": null })), "gone.example", {});
    expect(r.err?.code).toBe("ENOTFOUND");
  });
});
