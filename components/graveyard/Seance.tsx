"use client";

import { useEffect, useRef, useState } from "react";
import type { Doc, LinkResult } from "@/lib/scan/types";
import { framedSnapshotUrl, patchPreview } from "@/lib/patch/preview";
import { SpiritIcon } from "./icons";
import { RESURRECTABLE, SPIRITS, fmtDate, fmtTs } from "./spirits";

type Props = {
  r: LinkResult | null;
  docs: Doc[];
  canPatch: boolean;
  chosen: boolean;
  onChoose: (url: string, v: boolean) => void;
  onClose: () => void;
};

/**
 * The séance: hold the dead link and its last good copy side by side before deciding.
 * Native <dialog> gives focus trapping and Esc for free. The iframe is sandboxed: no scripts,
 * no forms, no popups, no top navigation. Only allow-same-origin is granted, so archived
 * stylesheets that carry SRI/crossorigin attributes still load; without scripts the frame
 * cannot act on that origin.
 */
export function Seance({ r, docs, canPatch, chosen, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [rising, setRising] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (r && !d.open) {
      setLoaded(false);
      setRising(false);
      d.showModal();
    } else if (!r && d.open) d.close();
  }, [r]);

  if (!r) return <dialog ref={ref} className="seance" aria-label="Séance" onClose={onClose} />;

  const s = SPIRITS[r.cls];
  const snap = r.snapshot;
  const lines = snap && docs.length ? patchPreview(docs, r, snap.url) : [];
  const canRaise = canPatch && !!snap && RESURRECTABLE.has(r.cls);

  function decide(v: boolean) {
    onChoose(r!.url, v);
    if (v) {
      setRising(true);
      setTimeout(() => ref.current?.close(), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900);
    } else ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      className={`seance c-${r.cls}${rising ? " is-rising" : ""}`}
      aria-labelledby="seance-h"
      aria-describedby="seance-d"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="seance-veil" aria-hidden="true">
        <span />
        <span />
      </div>
      <header className="seance-head">
        <span className="seance-stone" aria-hidden="true">
          <SpiritIcon cls={r.cls} size={30} />
        </span>
        <div>
          <p className="kind">{s.label} · séance</p>
          <h2 id="seance-h">{r.reasons[0]}</h2>
          <p className="url" id="seance-d">
            {r.url}
          </p>
        </div>
        <button type="button" className="btn btn-quiet seance-x" onClick={() => ref.current?.close()} aria-label="Close the séance">
          ✕
        </button>
      </header>

      <div className="seance-panes">
        <section className="pane pane-then" aria-label={snap ? `Archived copy from ${fmtTs(snap.timestamp)}` : "No archived copy"}>
          <p className="pane-tag">
            <span className="dot" aria-hidden="true" /> Then{snap ? ` · ${fmtTs(snap.timestamp)}` : ""}
            {snap && <em>{snap.beforeCite ? "closest copy before it was cited" : "latest surviving copy"}</em>}
          </p>
          {snap ? (
            <div className={`frame${loaded ? " is-loaded" : ""}`}>
              <iframe
                src={framedSnapshotUrl(snap.url)}
                title={`Wayback Machine copy of ${r.url} from ${fmtTs(snap.timestamp)}`}
                sandbox="allow-same-origin"
                referrerPolicy="no-referrer"
                loading="lazy"
                onLoad={() => setLoaded(true)}
              />
              <div className="frame-wait" aria-hidden="true">
                <span className="candle" />
                <span>Summoning the {fmtTs(snap.timestamp).slice(0, 4)} copy…</span>
              </div>
            </div>
          ) : (
            <div className="frame frame-empty">
              <p>The Wayback Machine never captured this page, so there is nothing to bring back. Keep it, or find a replacement by hand.</p>
            </div>
          )}
        </section>

        <section className="pane pane-now" aria-label="The link today">
          <p className="pane-tag">
            <span className="dot" aria-hidden="true" /> Now · {r.status ? `HTTP ${r.status}` : "no answer"}
          </p>
          <div className="epitaph">
            <SpiritIcon cls={r.cls} size={64} className="epitaph-spirit" />
            <p className="epitaph-cause">{s.label === "Living" ? "Still alive." : `Here lies a link, ${s.verb}.`}</p>
            <dl>
              <div>
                <dt>Cited</dt>
                <dd>
                  {fmtDate(r.citeDate)}
                  {r.citeSource === "git" ? " (git history)" : ""}
                </dd>
              </div>
              {r.finalUrl && r.finalUrl !== r.url && (
                <div>
                  <dt>Lands on</dt>
                  <dd className="mono">{r.finalUrl}</dd>
                </div>
              )}
              {r.title && (
                <div>
                  <dt>Title today</dt>
                  <dd>“{r.title.slice(0, 120)}”</dd>
                </div>
              )}
              {r.drift !== undefined && (
                <div>
                  <dt>Same words as then</dt>
                  <dd>{Math.round(r.drift * 100)}%</dd>
                </div>
              )}
              {r.rdapRegistered && (
                <div>
                  <dt>Domain registered</dt>
                  <dd>{fmtDate(r.rdapRegistered)}</dd>
                </div>
              )}
              <div>
                <dt>Sure</dt>
                <dd>{Math.round(r.confidence * 100)}%</dd>
              </div>
            </dl>
            <ul className="epitaph-reasons">
              {r.reasons.slice(1, 4).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {lines.length > 0 && (
        <section className="seance-patch" aria-label="What the patch changes">
          <p className="pane-tag">The patch</p>
          {lines.map((l) => (
            <div key={l.where} className="diffline">
              <span className="where">{l.where}</span>
              <code className="del">− {l.before.trim()}</code>
              <code className="add">+ {l.after.trim()}</code>
            </div>
          ))}
        </section>
      )}

      <footer className="seance-foot">
        {snap && (
          <a className="btn btn-quiet" href={snap.url} target="_blank" rel="noopener noreferrer">
            Open in the Wayback Machine ↗
          </a>
        )}
        <span className="grow" />
        {canRaise ? (
          <>
            <button type="button" className="btn btn-quiet" onClick={() => decide(false)}>
              {chosen ? "Let it rest" : "Leave it"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => decide(true)} autoFocus>
              <span className="btn-lantern" aria-hidden="true" />
              {chosen ? "Keep resurrected" : "Resurrect"}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()} autoFocus>
            Close
          </button>
        )}
      </footer>
      <div className="seance-rise" aria-hidden="true">
        <SpiritIcon cls="living" size={80} />
      </div>
    </dialog>
  );
}
