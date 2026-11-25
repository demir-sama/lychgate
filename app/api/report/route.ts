import { ReportInputSchema, summarize } from "@/lib/report/report";
import { saveReport, sharingEnabled } from "@/lib/report/store";
import { RateLimiter } from "@/lib/util/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new RateLimiter(10, 10 * 60_000);
const MAX_BYTES = 600_000;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Save a finished scan as a public, read-only report for 30 days. */
export async function POST(req: Request) {
  if (!sharingEnabled()) return Response.json({ error: "Sharing is not configured on this deployment." }, { status: 503 });
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return Response.json({ error: `Too many shares. Try again in ${rl.retryAfterS}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfterS) } });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return Response.json({ error: "Report too large." }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Report too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = ReportInputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "That doesn't look like a Lychgate scan." }, { status: 400 });
  // The server recomputes the score; the client can't claim a healthier graveyard than it sent.
  const summary = summarize(parsed.data.results);
  try {
    const id = await saveReport(parsed.data.source, summary, parsed.data.results);
    return Response.json({ id, path: `/r/${id}`, badge: `/api/badge/${id}` }, { status: 201 });
  } catch {
    return Response.json({ error: "Couldn't save the report. Try again." }, { status: 500 });
  }
}
