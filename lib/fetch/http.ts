import { Agent, fetch as undiciFetch } from "undici";
import { assertPublicUrl, createGuardedLookup, defaultResolver, DnsError, SsrfError, type Resolver } from "./guard";

export const USER_AGENT =
  "LychgateBot/0.1 (+https://github.com/demir-sama/lychgate; polite link checker for Kiroween 2026)";
export const DEFAULT_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 5;
export const DEFAULT_MAX_BYTES = 512 * 1024;

export type FetchErrorKind = "ssrf" | "dns" | "timeout" | "tls" | "connection" | "too_many_redirects" | "invalid" | "aborted";

export class FetchFailure extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
    readonly redirects: RedirectHop[] = [],
    readonly code?: string,
  ) {
    super(message);
    this.name = "FetchFailure";
  }
}

export type RedirectHop = { from: string; to: string; status: number };

export type TransportInit = { method: "GET" | "HEAD"; headers: Record<string, string>; signal: AbortSignal };
/** Performs ONE request without following redirects. Must return a WHATWG Response. */
export type Transport = (url: string, init: TransportInit) => Promise<Response>;

let sharedAgent: Agent | undefined;
function guardedAgent(): Agent {
  if (!sharedAgent) {
    sharedAgent = new Agent({
      connect: { lookup: createGuardedLookup(defaultResolver) as never, timeout: DEFAULT_TIMEOUT_MS },
      headersTimeout: DEFAULT_TIMEOUT_MS,
      bodyTimeout: DEFAULT_TIMEOUT_MS,
      connections: 8, // per-origin socket cap
    });
  }
  return sharedAgent;
}

export const defaultTransport: Transport = async (url, init) => {
  const res = await undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    signal: init.signal,
    redirect: "manual",
    dispatcher: guardedAgent(),
  });
  return res as unknown as Response;
};

export type SafeFetchOptions = {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  readBody?: boolean;
  resolver?: Resolver;
  transport?: Transport;
  signal?: AbortSignal;
  accept?: string;
  /** extra request headers (e.g. GitHub API accept/authorization); never logged */
  headers?: Record<string, string>;
};

export type SafeFetchResult = {
  status: number;
  finalUrl: string;
  redirects: RedirectHop[];
  headers: Headers;
  contentType: string;
  body?: string;
  truncated?: boolean;
};

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      void reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}

export function classifyError(err: unknown): { kind: FetchErrorKind; code?: string; message: string } {
  if (err instanceof FetchFailure) return { kind: err.kind, code: err.code, message: err.message };
  if (err instanceof SsrfError) return { kind: "ssrf", code: err.code, message: err.message };
  if (err instanceof DnsError) return { kind: "dns", code: err.code, message: err.message };
  const e = err as { name?: string; code?: string; message?: string; cause?: unknown };
  const cause = (e?.cause ?? {}) as { name?: string; code?: string; message?: string };
  if (cause instanceof SsrfError || cause.code === "SSRF_BLOCKED" || cause.code === "ESSRF") {
    return { kind: "ssrf", code: "SSRF_BLOCKED", message: cause.message ?? "blocked" };
  }
  if (cause instanceof DnsError) return { kind: "dns", code: cause.code, message: cause.message ?? "dns" };
  const code = cause.code ?? e?.code;
  const name = e?.name ?? "";
  if (name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "ETIMEDOUT") {
    return { kind: "timeout", code, message: "timed out" };
  }
  if (name === "AbortError") return { kind: "aborted", code, message: "aborted" };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA" || code === "EAI_NONAME") {
    return { kind: "dns", code, message: `DNS lookup failed (${code})` };
  }
  if (code && (code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code.includes("SSL") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN")) {
    return { kind: "tls", code, message: `TLS error (${code})` };
  }
  return { kind: "connection", code, message: cause.message ?? e?.message ?? "connection failed" };
}

/**
 * Fetch with SSRF protection on every hop. Redirects are followed manually so
 * each Location is re-validated (shape + DNS) before we connect to it; the
 * default transport additionally validates the IP at socket-connect time.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const resolver = opts.resolver ?? defaultResolver;
  const transport = opts.transport ?? defaultTransport;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const redirects: RedirectHop[] = [];
  let current = input;

  for (let hop = 0; ; hop++) {
    let url: URL;
    try {
      url = await assertPublicUrl(current, resolver);
    } catch (err) {
      const c = classifyError(err);
      throw new FetchFailure(c.kind, c.message, redirects, c.code);
    }
    if (signal.aborted) {
      throw new FetchFailure(timeout.aborted ? "timeout" : "aborted", timeout.aborted ? "timed out" : "aborted", redirects);
    }
    let res: Response;
    try {
      res = await transport(url.href, {
        method,
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en",
          ...(opts.headers ?? {}),
        },
      });
    } catch (err) {
      const c = classifyError(timeout.aborted ? Object.assign(new Error("timeout"), { name: "TimeoutError" }) : err);
      throw new FetchFailure(c.kind, c.message, redirects, c.code);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      void res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new FetchFailure("too_many_redirects", `more than ${maxRedirects} redirects`, redirects);
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new FetchFailure("invalid", `invalid redirect Location: ${location.slice(0, 200)}`, redirects);
      }
      redirects.push({ from: url.href, to: next.href, status: res.status });
      current = next.href;
      continue;
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const result: SafeFetchResult = { status: res.status, finalUrl: url.href, redirects, headers: res.headers, contentType };
    if (method === "GET" && opts.readBody) {
      try {
        const { text, truncated } = await readCapped(res, maxBytes);
        result.body = text;
        result.truncated = truncated;
      } catch (err) {
        const c = classifyError(timeout.aborted ? Object.assign(new Error("timeout"), { name: "TimeoutError" }) : err);
        throw new FetchFailure(c.kind, c.message, redirects, c.code);
      }
    } else {
      void res.body?.cancel().catch(() => {});
    }
    return result;
  }
}

export type LinkProbe = {
  url: string;
  ok: boolean;
  method: "HEAD" | "GET";
  status?: number;
  finalUrl?: string;
  redirects: RedirectHop[];
  contentType?: string;
  body?: string;
  /** seconds from a Retry-After header on 429/503 (capped at 60) */
  retryAfter?: number;
  error?: { kind: FetchErrorKind; code?: string; message: string };
};

/** Parse Retry-After (delta-seconds or HTTP date) into seconds, capped at 60. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Math.min(60, Number(v));
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.min(60, Math.ceil((t - now) / 1000)));
}

const META_REFRESH = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i;

/** Absolute target of a meta-refresh tag, if any. */
export function metaRefreshTarget(html: string, base: string): string | null {
  const tag = META_REFRESH.exec(html)?.[0];
  if (!tag) return null;
  const content = /content\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] ?? "";
  const m = /url\s*=\s*['"]?([^'";]+)/i.exec(content);
  if (!m) return null;
  try {
    const target = new URL(m[1].trim(), base).href;
    return target === base ? null : target;
  } catch {
    return null;
  }
}

const isHtml = (ct: string) => ct.includes("text/html") || ct.includes("application/xhtml");

/**
 * HEAD first (cheap); fall back to GET when HEAD is refused or errors.
 * When the target is HTML and `wantBody` is set, a GET is made to read the
 * (capped) body for soft-404 / parked / drift analysis.
 */
export async function probeLink(url: string, opts: Omit<SafeFetchOptions, "method" | "readBody"> & { wantBody?: boolean } = {}): Promise<LinkProbe> {
  let head: SafeFetchResult | undefined;
  try {
    head = await safeFetch(url, { ...opts, method: "HEAD" });
  } catch (err) {
    const c = classifyError(err);
    if (c.kind === "ssrf" || c.kind === "dns") {
      return { url, ok: false, method: "HEAD", redirects: err instanceof FetchFailure ? err.redirects : [], error: c };
    }
    // timeouts / resets on HEAD: retry with GET below
  }
  const headUsable = head && head.status >= 200 && head.status < 300;
  if (headUsable && !(opts.wantBody && isHtml(head!.contentType))) {
    return { url, ok: true, method: "HEAD", status: head!.status, finalUrl: head!.finalUrl, redirects: head!.redirects, contentType: head!.contentType };
  }
  try {
    let get = await safeFetch(url, { ...opts, method: "GET", readBody: opts.wantBody !== false });
    // Follow one <meta http-equiv="refresh"> stub (common for http→https and "moved" pages).
    const refresh = get.status === 200 && get.body && get.body.length < 8192 ? metaRefreshTarget(get.body, get.finalUrl) : null;
    if (refresh && get.redirects.length < MAX_REDIRECTS) {
      const hop: RedirectHop = { from: get.finalUrl, to: refresh, status: 200 };
      try {
        const next = await safeFetch(refresh, { ...opts, method: "GET", readBody: opts.wantBody !== false, maxRedirects: MAX_REDIRECTS - get.redirects.length - 1 });
        get = { ...next, redirects: [...get.redirects, hop, ...next.redirects] };
      } catch (err) {
        if (err instanceof FetchFailure) throw new FetchFailure(err.kind, err.message, [...get.redirects, hop, ...err.redirects], err.code);
        throw err;
      }
    }
    const body = isHtml(get.contentType) || get.contentType === "" ? get.body : undefined;
    return {
      url,
      ok: get.status >= 200 && get.status < 300,
      method: "GET",
      status: get.status,
      finalUrl: get.finalUrl,
      redirects: get.redirects,
      contentType: get.contentType,
      body,
      retryAfter: get.status === 429 || get.status === 503 ? parseRetryAfter(get.headers.get("retry-after")) : undefined,
    };
  } catch (err) {
    const c = classifyError(err);
    return { url, ok: false, method: "GET", redirects: err instanceof FetchFailure ? err.redirects : [], error: c };
  }
}
