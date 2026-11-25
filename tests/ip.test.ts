import fc from "fast-check";
import { describe, expect, it, afterEach, vi } from "vitest";
import { checkIp, devFakeIpAllowed, isIpLiteral, isPublicIp } from "@/lib/net/ip";

const BLOCKED = [
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.127.255.254",
  "127.0.0.1",
  "127.255.255.255",
  "169.254.169.254", // AWS/GCP/Azure metadata
  "169.254.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.192", // Oracle Cloud metadata
  "192.0.2.1",
  "192.168.1.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.7",
  "203.0.113.9",
  "224.0.0.1",
  "239.255.255.250",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "[::1]",
  "fe80::1",
  "fc00::1",
  "fd00:ec2::254", // AWS IMDS IPv6
  "fd12:3456:789a::1",
  "ff02::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:10.0.0.1",
  "::ffff:169.254.169.254",
  "::127.0.0.1",
  "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
  "64:ff9b::808:808", // NAT64 of public: still refused (we don't route via NAT64)
  "64:ff9b:1::1",
  "2001:db8::1",
  "2002:7f00:1::1", // 6to4 of 127.0.0.1
  "2001:0:4136:e378::1", // Teredo
  "100::1",
  "fe80::1%eth0",
];
const ALLOWED = ["93.184.216.34", "8.8.8.8", "1.1.1.1", "140.82.112.3", "172.32.0.1", "172.15.255.255", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"];

describe("checkIp", () => {
  it.each(BLOCKED)("blocks %s", (ip) => {
    expect(checkIp(ip).ok).toBe(false);
    expect(isPublicIp(ip)).toBe(false);
  });
  it.each(ALLOWED)("allows %s", (ip) => {
    expect(checkIp(ip)).toMatchObject({ ok: true });
  });
  it("rejects non-IPs and non-canonical IPv4 literals", () => {
    for (const s of ["", "localhost", "example.com", "0x7f.0.0.1", "0177.0.0.1", "127.1", "1.2.3", "999.1.1.1"]) {
      expect(checkIp(s).ok).toBe(false);
    }
  });
  it("gives a reason", () => {
    const v = checkIp("10.1.2.3");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/private/);
  });

  it("property: every RFC1918 / loopback / link-local IPv4 is blocked, also when IPv4-mapped", () => {
    const octet = fc.integer({ min: 0, max: 255 });
    const priv = fc.oneof(
      fc.tuple(octet, octet, octet).map(([b, c, d]) => `10.${b}.${c}.${d}`),
      fc.tuple(fc.integer({ min: 16, max: 31 }), octet, octet).map(([b, c, d]) => `172.${b}.${c}.${d}`),
      fc.tuple(octet, octet).map(([c, d]) => `192.168.${c}.${d}`),
      fc.tuple(octet, octet, octet).map(([b, c, d]) => `127.${b}.${c}.${d}`),
      fc.tuple(octet, octet).map(([c, d]) => `169.254.${c}.${d}`),
      fc.tuple(fc.integer({ min: 64, max: 127 }), octet, octet).map(([b, c, d]) => `100.${b}.${c}.${d}`),
    );
    fc.assert(
      fc.property(priv, (ip) => {
        expect(isPublicIp(ip)).toBe(false);
        expect(isPublicIp(`::ffff:${ip}`)).toBe(false);
      }),
    );
  });

  it("property: unique-local and link-local IPv6 are blocked", () => {
    const hextet = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16));
    fc.assert(
      fc.property(fc.integer({ min: 0xfc00, max: 0xfdff }), hextet, hextet, (a, b, c) => {
        expect(isPublicIp(`${a.toString(16)}:${b}::${c}`)).toBe(false);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0xfe80, max: 0xfebf }), hextet, (a, b) => {
        expect(isPublicIp(`${a.toString(16)}::${b}`)).toBe(false);
      }),
    );
  });
});

describe("isIpLiteral", () => {
  it("detects literals", () => {
    expect(isIpLiteral("1.2.3.4")).toBe(true);
    expect(isIpLiteral("[::1]")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });
});

describe("devFakeIpAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is only honoured outside production and outside Vercel", () => {
    expect(devFakeIpAllowed({ LYCHGATE_DEV_ALLOW_FAKE_IP: "1", NODE_ENV: "development" })).toBe(true);
    expect(devFakeIpAllowed({ LYCHGATE_DEV_ALLOW_FAKE_IP: "1", NODE_ENV: "production" })).toBe(false);
    expect(devFakeIpAllowed({ LYCHGATE_DEV_ALLOW_FAKE_IP: "1", NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(devFakeIpAllowed({ NODE_ENV: "development" })).toBe(false);
  });
  it("only opens 198.18.0.0/15, never loopback or metadata", () => {
    vi.stubEnv("LYCHGATE_DEV_ALLOW_FAKE_IP", "1");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "");
    expect(isPublicIp("198.18.0.1")).toBe(true);
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("169.254.169.254")).toBe(false);
    expect(isPublicIp("10.0.0.1")).toBe(false);
  });
});
