import { badgeSvg, isReportId } from "@/lib/report/report";
import { loadBadge } from "@/lib/report/store";

export const runtime = "nodejs";

/** README badge for a shared report. Cached briefly; expired or unknown ids get a grey badge, never an error image. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const clean = id.replace(/\.svg$/, "");
  let data: { health: number; dead: number } | null = null;
  if (isReportId(clean)) {
    try {
      data = await loadBadge(clean);
    } catch {
      data = null;
    }
  }
  const svg = badgeSvg(data ? { health: data.health, dead: data.dead } : { health: null });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
