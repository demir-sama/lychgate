import { neon } from "@neondatabase/serverless";
import type { ScanSummary } from "../scan/types";
import { REPORT_TTL_DAYS, newReportId, type SharedResult, type StoredReport } from "./report";

/**
 * Shareable reports live in Neon Postgres for 30 days. No accounts, no IPs, no personal data:
 * only the scanned source label and the per-link verdicts.
 */
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Sharing is not configured on this deployment.");
  return neon(url);
}

export function sharingEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export async function saveReport(source: string, summary: ScanSummary, results: SharedResult[]): Promise<string> {
  const sql = db();
  const id = newReportId();
  await sql`INSERT INTO reports (id, source, health, summary, results, expires_at)
    VALUES (${id}, ${source}, ${summary.health}, ${JSON.stringify(summary)}::jsonb, ${JSON.stringify(results)}::jsonb, now() + make_interval(days => ${REPORT_TTL_DAYS}))`;
  // Opportunistic retention sweep: expired reports are deleted, not just hidden.
  await sql`DELETE FROM reports WHERE expires_at < now()`;
  return id;
}

export async function loadReport(id: string): Promise<StoredReport | null> {
  const sql = db();
  const rows = (await sql`SELECT id, source, health, summary, results, created_at, expires_at FROM reports WHERE id = ${id} AND expires_at > now()`) as Array<{
    id: string;
    source: string;
    health: number;
    summary: ScanSummary;
    results: SharedResult[];
    created_at: string | Date;
    expires_at: string | Date;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    source: r.source,
    health: r.health,
    summary: r.summary,
    results: r.results,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  };
}

export async function loadBadge(id: string): Promise<{ health: number; dead: number } | null> {
  const sql = db();
  const rows = (await sql`SELECT health, summary FROM reports WHERE id = ${id} AND expires_at > now()`) as Array<{ health: number; summary: ScanSummary }>;
  const r = rows[0];
  if (!r) return null;
  return { health: r.health, dead: (r.summary.tombstone ?? 0) + (r.summary.ghost ?? 0) + (r.summary.zombie ?? 0) };
}
