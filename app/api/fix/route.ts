import { FixInputSchema } from "@/lib/fix/plan";
import { FixError, openFixPullRequest } from "@/lib/fix/github";
import { safeMessage } from "@/lib/fix/redact";
import { isSameOrigin } from "@/lib/util/sameorigin";
import { RateLimiter } from "@/lib/util/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;
const BUDGET_MS = 25_000;
// Its own bucket: opening a pull request is a rare, deliberate act (fix-it R3.2).
// The key is the IP only; the token is never part of it (R3.9).
const limiter = new RateLimiter(5, 10 * 60_000);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const KNOWN = new Set([401, 403, 404, 422, 429, 502, 504]);

const fail = (status: number, error: string, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { ...headers, ...extra } });

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Read at most MAX_BODY_BYTES; null when the body is larger. Content-Length is only a fast path. */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Open a "Fix it" pull request with the caller's own GitHub token, for this one request only. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return fail(403, "Same-origin requests only.");
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return fail(429, `Too many pull requests. Try again in ${rl.retryAfterS}s.`, { "retry-after": String(rl.retryAfterS) });

  let text: string | null;
  try {
    text = await readCapped(req);
  } catch {
    return fail(400, "Send JSON.");
  }
  if (text === null) return fail(413, "That request is too large (64 KB at most). Use the downloads instead.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "Send JSON.");
  }
  const parsed = FixInputSchema.safeParse(body);
  if (!parsed.success) {
    // Field names and fixed messages only; the submitted values are never repeated.
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return fail(400, safeMessage(msg).slice(0, 300));
  }

  const { token } = parsed.data;
  try {
    const result = await openFixPullRequest(parsed.data, {
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(BUDGET_MS)]),
    });
    return Response.json(result, { headers });
  } catch (e) {
    if (e instanceof FixError) {
      return fail(KNOWN.has(e.status) ? e.status : 502, safeMessage(e, token));
    }
    return fail(502, "Couldn't open the pull request. Try again.");
  }
}
