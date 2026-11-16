import ipaddr from "ipaddr.js";

/**
 * SSRF address policy.
 *
 * Allow-list approach: an address is fetchable only if ipaddr.js classifies it
 * as plain global "unicast". Everything else (private, loopback, link-local,
 * CGNAT, multicast, reserved, documentation, benchmarking, 6to4, Teredo,
 * NAT64, unique-local, unspecified, broadcast...) is refused.
 *
 * IPv4-mapped / IPv4-compatible IPv6 and NAT64 (64:ff9b::/96) addresses are
 * unwrapped and the embedded IPv4 address is checked with the IPv4 policy.
 */

// Extra IPv4 ranges we block even if a future ipaddr.js version calls them unicast.
const EXTRA_V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["169.254.0.0", 16], // link-local incl. 169.254.169.254 metadata
  ["192.0.0.0", 24], // IETF protocol assignments (incl. 192.0.0.192 Oracle metadata)
  ["198.18.0.0", 15], // benchmarking
  ["240.0.0.0", 4],
];

// Well-known cloud metadata IPv6 endpoints (AWS IMDS v6 lives in fd00:ec2::/32, already ULA).
const EXTRA_V6_BLOCKS: Array<[string, number]> = [
  ["fd00:ec2::", 32],
  ["64:ff9b:1::", 48], // local-use NAT64
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["2001::", 32], // Teredo
  ["100::", 64], // discard-only
];

export type IpVerdict = { ok: true; normalized: string } | { ok: false; reason: string };

/**
 * Local development only: some sandboxes run a "fake-IP" DNS proxy that answers every
 * lookup with an address in 198.18.0.0/15. Setting LYCHGATE_DEV_ALLOW_FAKE_IP=1 lets those
 * through so the scanner can be exercised locally. It is ignored in production and on Vercel.
 */
export function devFakeIpAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.LYCHGATE_DEV_ALLOW_FAKE_IP === "1" && env.NODE_ENV !== "production" && !env.VERCEL;
}

function checkV4(addr: ipaddr.IPv4): IpVerdict {
  if (devFakeIpAllowed() && addr.match(ipaddr.IPv4.parse("198.18.0.0"), 15)) return { ok: true, normalized: addr.toString() };
  const range = addr.range();
  if (range !== "unicast") return { ok: false, reason: `IPv4 ${range} address` };
  for (const [net, bits] of EXTRA_V4_BLOCKS) {
    if (addr.match(ipaddr.IPv4.parse(net), bits)) return { ok: false, reason: `IPv4 reserved range ${net}/${bits}` };
  }
  return { ok: true, normalized: addr.toString() };
}

export function checkIp(input: string): IpVerdict {
  let raw = input.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) raw = raw.slice(1, -1);
  // Strip IPv6 zone id (fe80::1%eth0) — zone ids imply link-local anyway.
  const zoneIdx = raw.indexOf("%");
  if (zoneIdx !== -1) return { ok: false, reason: "IPv6 address with zone id" };
  if (!ipaddr.isValid(raw)) return { ok: false, reason: "not an IP address" };
  // Only accept canonical dotted-quad for IPv4 (reject 0x7f.1, 2130706433, 0177.0.0.1 forms
  // here; the WHATWG URL parser normalises those before we ever see them).
  if (raw.includes(".") && !raw.includes(":") && !ipaddr.IPv4.isValidFourPartDecimal(raw)) {
    return { ok: false, reason: "non-canonical IPv4 literal" };
  }
  const addr = ipaddr.parse(raw);
  if (addr.kind() === "ipv4") return checkV4(addr as ipaddr.IPv4);

  const v6 = addr as ipaddr.IPv6;
  if (v6.isIPv4MappedAddress()) return checkV4(v6.toIPv4Address());
  const bytes = v6.toByteArray();
  // IPv4-compatible (deprecated) ::a.b.c.d
  if (bytes.slice(0, 12).every((b) => b === 0) && !(bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && bytes[15] <= 1)) {
    return checkV4(ipaddr.IPv4.parse(bytes.slice(12).join(".")));
  }
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address.
  if (v6.match(ipaddr.IPv6.parse("64:ff9b::"), 96)) {
    const inner = checkV4(ipaddr.IPv4.parse(bytes.slice(12).join(".")));
    return inner.ok ? { ok: false, reason: "IPv6 NAT64 address" } : inner;
  }
  const range = v6.range();
  if (range !== "unicast") return { ok: false, reason: `IPv6 ${range} address` };
  for (const [net, bits] of EXTRA_V6_BLOCKS) {
    if (v6.match(ipaddr.IPv6.parse(net), bits)) return { ok: false, reason: `IPv6 reserved range ${net}/${bits}` };
  }
  // Global unicast is 2000::/3 only.
  if ((bytes[0] & 0xe0) !== 0x20) return { ok: false, reason: "IPv6 outside global unicast 2000::/3" };
  return { ok: true, normalized: v6.toNormalizedString() };
}

export function isPublicIp(input: string): boolean {
  return checkIp(input).ok;
}

export function isIpLiteral(host: string): boolean {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return ipaddr.isValid(h);
}
