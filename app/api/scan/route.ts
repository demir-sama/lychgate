import { runScan } from "@/lib/scan/engine";
import { ScanInputSchema } from "@/lib/scan/input";
import { RateLimiter } from "@/lib/util/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const limiter = new RateLimiter(6, 10 * 60_000);

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

export async function POST(req: Request) {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) {
    return Response.json({ error: `Too many scans. Try again in ${rl.retryAfterS}s.` }, { status: 429, headers: { "retry-after": String(rl.retryAfterS) } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = ScanInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of runScan(parsed.data, { budgetMs: 270_000, signal: abort.signal })) {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: (err as Error).message }) + "\n"));
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
