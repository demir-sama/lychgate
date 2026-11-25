import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReportView from "@/components/ReportView";
import { isReportId } from "@/lib/report/report";
import { loadReport } from "@/lib/report/store";

export const dynamic = "force-dynamic";

async function get(id: string) {
  if (!isReportId(id)) return null;
  try {
    return await loadReport(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await get(id);
  if (!r) return { title: "Report not found · Lychgate", robots: { index: false } };
  const dead = r.summary.tombstone + r.summary.ghost + r.summary.zombie;
  return {
    title: `${r.source}: ${r.health}% alive · Lychgate`,
    description: `${r.summary.total} links checked, ${dead} dead or unsafe. Each grave shows how it died and the Wayback copy that can bring it back.`,
    robots: { index: false },
  };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await get(id);
  if (!r) notFound();
  return (
    <>
      <a className="skip" href="#main">
        Skip to the report
      </a>
      <div className="fogfield" aria-hidden="true">
        <span />
        <span />
      </div>
      <ReportView report={r} />
      <footer className="foot">
        <p>
          A shared Lychgate report. It is deleted on {r.expiresAt.slice(0, 10)}. Built by Demir for Kiroween 2026 · <a href="https://github.com/demir-sama/lychgate">source on GitHub</a> (MIT).
        </p>
      </footer>
    </>
  );
}
