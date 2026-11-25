"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LinkClass } from "@/lib/classify/classify";
import type { StoredReport } from "@/lib/report/report";
import type { LinkResult } from "@/lib/scan/types";
import { GraveCard } from "./graveyard/GraveCard";
import { HealthGauge } from "./graveyard/HealthGauge";
import { SpiritIcon } from "./graveyard/icons";
import { Plot } from "./graveyard/Plot";
import { Seance } from "./graveyard/Seance";
import { useLookups } from "./graveyard/useLookups";
import { ORDER, RESURRECTABLE, SPIRITS } from "./graveyard/spirits";

const openable = (r?: LinkResult) => !!r && (!!r.snapshot || RESURRECTABLE.has(r.cls));

/** Read-only graveyard for a shared report: same spirits, same séance, no patching. */
export default function ReportView({ report }: { report: StoredReport }) {
  const results = useMemo<LinkResult[]>(() => report.results.map((r) => ({ ...r, redirects: [], ms: 0 })), [report]);
  const [filter, setFilter] = useState<LinkClass | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [seance, setSeance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { lookups, lookup } = useLookups();

  useEffect(() => {
    const saved = localStorage.getItem("lychgate:daylight");
    document.documentElement.dataset.theme = saved === "1" ? "daylight" : "night";
    document.documentElement.style.setProperty("--fog", Math.max(0.12, (100 - report.health) / 100).toFixed(2));
  }, [report.health]);

  const sorted = useMemo(
    () => results.filter((r) => filter === "all" || r.cls === filter).sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || b.confidence - a.confidence),
    [results, filter],
  );
  const s = report.summary;
  const dead = s.tombstone + s.ghost + s.zombie;

  async function copyBadge() {
    const o = window.location.origin;
    await navigator.clipboard.writeText(`[![Lychgate link health](${o}/api/badge/${report.id})](${o}/r/${report.id})`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <nav className="topbar" aria-label="Lychgate">
        <Link className="brand" href="/" aria-label="Lychgate home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26">
              <path d="M2 12 Q10 11 16 4 Q22 11 30 12 L28 14 Q22 13 16 7 Q10 13 4 14Z" fill="currentColor" />
              <rect x="7" y="13" width="3" height="16" fill="currentColor" />
              <rect x="22" y="13" width="3" height="16" fill="currentColor" />
              <rect x="14.5" y="16" width="3" height="5" rx="1" fill="var(--lantern)" />
            </svg>
          </span>
          Lychgate
        </Link>
        <Link className="btn btn-primary" href="/">
          <span className="btn-lantern" aria-hidden="true" />
          Scan your own
        </Link>
      </nav>
      <main className="shell report" id="main">
        <section className="yard" aria-labelledby="yard-h">
          <p className="eyebrow">Shared report · {report.createdAt.slice(0, 10)}</p>
          <div className="yard-head">
            <HealthGauge health={report.health} settled />
            <div className="yard-title">
              <h1 id="yard-h">{report.source}</h1>
              <p>
                {s.total} links checked{dead ? ` · ${dead} dead or unsafe` : " · no dead links"}
              </p>
              <div className="share-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/badge/${report.id}`} alt={`Link health badge: ${report.health}% alive`} height={20} />
                <button type="button" className="btn btn-quiet" onClick={copyBadge}>
                  {copied ? "Copied ✓" : "Copy README badge"}
                </button>
              </div>
            </div>
          </div>
          <Plot results={results} total={results.length} onPick={(u) => setSeance(openable(results.find((r) => r.url === u)) ? u : null)} />
          <div className="chips" role="group" aria-label="Filter graves">
            <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All <span className="n">{results.length}</span>
            </button>
            {ORDER.filter((k) => (s[k] ?? 0) > 0).map((k) => (
              <button key={k} type="button" className={`chip c-${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)} title={SPIRITS[k].blurb}>
                <SpiritIcon cls={k} size={16} /> {SPIRITS[k].plural} <span className="n">{s[k]}</span>
              </button>
            ))}
          </div>
          <ol className="graves" aria-label="Checked links, worst first">
            {sorted.map((r) => (
              <GraveCard
                key={r.url}
                r={r}
                canPatch={false}
                chosen={false}
                onChoose={() => {}}
                open={open === r.url}
                onToggle={(v) => setOpen((o) => (v ? r.url : o === r.url ? null : o))}
                onSeance={openable(r) ? () => setSeance(r.url) : undefined}
              />
            ))}
          </ol>
        </section>
        <Seance r={seance ? (results.find((x) => x.url === seance) ?? null) : null} docs={[]} canPatch={false} choice="keep" lookup={(seance && lookups[seance]) || { state: "idle" }} onLookup={lookup} onChoice={() => {}} onClose={() => setSeance(null)} />
      </main>
    </>
  );
}
