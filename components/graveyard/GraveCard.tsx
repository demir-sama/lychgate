"use client";

import type { LinkResult } from "@/lib/scan/types";
import { SpiritIcon } from "./icons";
import { RESURRECTABLE, SPIRITS, fmtDate, fmtTs } from "./spirits";

export function graveId(url: string) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return `grave-${(h >>> 0).toString(36)}`;
}

type Props = {
  r: LinkResult;
  canPatch: boolean;
  chosen: boolean;
  onChoose: (v: boolean) => void;
  open: boolean;
  onToggle: (v: boolean) => void;
  onSeance?: () => void;
};

export function GraveCard({ r, canPatch, chosen, onChoose, open, onToggle, onSeance }: Props) {
  const s = SPIRITS[r.cls];
  const id = graveId(r.url);
  const conf = Math.round(r.confidence * 100);
  const where = r.occurrences.slice(0, 3).map((o) => (o.line ? `${o.doc}:${o.line}` : o.doc));
  return (
    <li className={`grave c-${r.cls}${chosen ? " is-raised" : ""}`} id={id} tabIndex={-1} aria-labelledby={`${id}-t`}>
      <div className="stone" aria-hidden="true">
        <SpiritIcon cls={r.cls} size={30} />
      </div>
      <div className="grave-body">
        <p className="grave-kind" id={`${id}-t`}>
          <span className="kind">{s.label}</span>
          <span className="sr-only">: </span>
          <span className="cause">{r.reasons[0]}</span>
        </p>
        <a className="url" href={r.url} target="_blank" rel="noopener noreferrer nofollow">
          {r.url}
        </a>
        <div className="grave-meta">
          <span>
            cited {fmtDate(r.citeDate)}
            {r.citeSource === "git" ? " · from git history" : r.citeSource === "user" ? " · your date" : ""}
          </span>
          {where.length > 0 && (
            <span>
              {where.join(", ")}
              {r.occurrences.length > 3 ? ` +${r.occurrences.length - 3}` : ""}
            </span>
          )}
          <span className="conf" title="How sure we are">
            <span className="conf-bar" aria-hidden="true">
              <span style={{ width: `${conf}%` }} />
            </span>
            {conf}% sure
          </span>
        </div>

        <details open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Evidence</summary>
          <ul className="evidence">
            {r.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
            <li>
              HTTP {r.status ?? "none"}
              {r.redirects.length ? ` after ${r.redirects.length} redirect${r.redirects.length > 1 ? "s" : ""} to ${r.finalUrl}` : ""}
              {r.title ? ` · title “${r.title.slice(0, 90)}”` : ""} · {r.ms} ms
            </li>
            {r.drift !== undefined && <li>{Math.round(r.drift * 100)}% text similarity to the snapshot from when it was cited.</li>}
            {r.rdapRegistered && <li>Domain registered {fmtDate(r.rdapRegistered)} (RDAP).</li>}
            {r.redirects.map((h, i) => (
              <li key={i} className="hop">
                {h.status} {h.from} → {h.to}
              </li>
            ))}
          </ul>
        </details>

        {(r.snapshot || onSeance) && (
          <div className="snap">
            {r.snapshot && (
              <span className="snap-label">
                {r.snapshot.beforeCite ? "Closest copy before it was cited" : "Latest surviving copy"}: <strong>{fmtTs(r.snapshot.timestamp)}</strong>
              </span>
            )}
            {onSeance ? (
              <button type="button" className="btn btn-quiet btn-seance" onClick={onSeance}>
                <span className="candle-sm" aria-hidden="true" />
                Hold a séance
                <span className="sr-only">{r.snapshot ? ": compare the archived copy with today, or look for a living replacement" : ": look for a living replacement"}</span>
              </button>
            ) : (
              r.snapshot && (
                <a className="btn btn-quiet" href={r.snapshot.url} target="_blank" rel="noopener noreferrer">
                  Preview<span className="sr-only"> snapshot (opens the Wayback Machine)</span> ↗
                </a>
              )
            )}
            {canPatch && r.snapshot && RESURRECTABLE.has(r.cls) && (
              <label className="switch">
                <input type="checkbox" checked={chosen} onChange={(e) => onChoose(e.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
                Resurrect
              </label>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
