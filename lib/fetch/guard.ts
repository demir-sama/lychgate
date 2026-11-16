import { lookup as dnsLookup } from "node:dns/promises";
import { checkIp, isIpLiteral } from "../net/ip";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const defaultResolver: Resolver = async (hostname) => {
  const res = await dnsLookup(hostname, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".corp",
  ".onion",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

export class SsrfError extends Error {
  readonly code = "SSRF_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export class DnsError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DnsError";
    this.code = code;
  }
}

/** Synchronous URL shape checks (no DNS). Throws SsrfError. Returns the parsed URL. */
export function assertSafeUrlShape(input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.href);
  } catch {
    throw new SsrfError("not a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) throw new SsrfError("credentials in URL are not allowed");
  if (!ALLOWED_PORTS.has(url.port)) throw new SsrfError(`port ${url.port} is not allowed`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new SsrfError("empty host");
  if (isIpLiteral(host)) {
    const v = checkIp(host);
    if (!v.ok) throw new SsrfError(`blocked address ${host}: ${v.reason}`);
    return url;
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfError(`blocked internal hostname ${host}`);
  }
  if (!host.includes(".")) throw new SsrfError(`single-label hostname ${host} is not allowed`);
  return url;
}

/**
 * Resolve a hostname and verify that EVERY returned address is public.
 * Any private address in the answer set causes a block (defends against
 * mixed answers used for DNS rebinding).
 */
export async function resolvePublic(hostname: string, resolver: Resolver = defaultResolver): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) {
    const v = checkIp(host);
    if (!v.ok) throw new SsrfError(`blocked address ${host}: ${v.reason}`);
    return [{ address: host, family: host.includes(":") ? 6 : 4 }];
  }
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolver(host);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "EDNS";
    throw new DnsError(`DNS lookup failed for ${host} (${code})`, code);
  }
  if (!addrs.length) throw new DnsError(`no DNS records for ${host}`, "ENODATA");
  for (const a of addrs) {
    const v = checkIp(a.address);
    if (!v.ok) throw new SsrfError(`${host} resolves to blocked address ${a.address}: ${v.reason}`);
  }
  return addrs;
}

/** Full pre-flight check: URL shape + DNS resolution of the host. */
export async function assertPublicUrl(input: string | URL, resolver: Resolver = defaultResolver): Promise<URL> {
  const url = assertSafeUrlShape(input);
  await resolvePublic(url.hostname, resolver);
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void;

/**
 * A dns.lookup-compatible function for undici's `connect.lookup`. It runs at
 * socket-connect time, so the address we validate is the address we connect
 * to (closes the DNS-rebinding TOCTOU window between pre-flight and connect).
 */
export function createGuardedLookup(resolver: Resolver = defaultResolver) {
  return function guardedLookup(hostname: string, options: unknown, callback?: LookupCb) {
    let cb = callback;
    let opts = options as { all?: boolean; family?: number } | number | undefined;
    if (typeof options === "function") {
      cb = options as LookupCb;
      opts = undefined;
    }
    const wantAll = typeof opts === "object" && opts !== null && opts.all === true;
    const family = typeof opts === "number" ? opts : typeof opts === "object" && opts ? opts.family : undefined;
    resolvePublic(hostname, resolver).then(
      (addrs) => {
        const filtered = family === 4 || family === 6 ? addrs.filter((a) => a.family === family) : addrs;
        const list = filtered.length ? filtered : addrs;
        if (wantAll) cb!(null, list.map((a) => ({ address: a.address, family: a.family })));
        else cb!(null, list[0].address, list[0].family);
      },
      (err: Error & { code?: string }) => {
        const e = err as NodeJS.ErrnoException;
        if (!e.code) e.code = "ESSRF";
        cb!(e);
      },
    );
  };
}
