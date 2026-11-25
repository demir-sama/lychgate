import { REPLACEMENT_BUDGET_MS, ReplacementInputSchema, suggestReplacement } from "@/lib/patch/replacement";
import { isSameOrigin } from "@/lib/util/sameorigin";
import { RateLimiter } from "@/lib/util/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Its own bucket, separate from /api/scan: each request is one user press on one link in the séance,
// so 30 per 10 minutes per IP (a scan is 6).
const limiter = new RateLimiter(30, 10 * 60_000);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Ask for one live replacement for a dead link (GitHub rename, redirect, or same-site sitemap). */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: "Same-origin requests only." }, { status: 403, headers });
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) {
    return Response.json({ error: `Too many lookups. Try again in ${rl.retryAfterS}s.` }, { status: 429, headers: { ...headers, "retry-after": String(rl.retryAfterS) } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400, headers });
  }
  const parsed = ReplacementInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400, headers });
  }
  const budget = AbortSignal.timeout(REPLACEMENT_BUDGET_MS);
  try {
    const replacement = await suggestReplacement(parsed.data.url, { signal: AbortSignal.any([req.signal, budget]) });
    return Response.json({ replacement, timedOut: replacement === null && budget.aborted }, { headers });
  } catch {
    return Response.json({ error: "Couldn't look for a replacement. Try again." }, { status: 500, headers });
  }
}
