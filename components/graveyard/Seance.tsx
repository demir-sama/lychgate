"use client";

import { useEffect, useRef, useState } from "react";
import type { Doc, LinkResult } from "@/lib/scan/types";
import { reasonText, targetFor, type Choice, type Lookup } from "@/lib/patch/choice";
import { framedSnapshotUrl, patchPreview } from "@/lib/patch/preview";
import { SpiritIcon } from "./icons";
import { RESURRECTABLE, SPIRITS, fmtDate, fmtTs } from "./spirits";

type Props = {
  r: LinkResult | null;
  docs: Doc[];
  canPatch: boolean;
  choice: Choice;
  lookup: Lookup;
  onLookup: (url: string) => void;
  onChoice: (url: string, c: Choice) => void;
  onClose: () => void;
};

/**
 * The séance: hold the dead link and its last good copy side by side before deciding.
 * Native <dialog> gives focus trapping and Esc for free. The iframe is sandboxed: no scripts,
 * no forms, no popups, no top navigation. Only allow-same-origin is granted, so archived
 * stylesheets that carry SRI/crossorigin attributes still load; without scripts the frame
 * cannot act on that origin.
 */
export function Seance({ r, docs, canPatch, choice, lookup, onLookup, onChoice, onClose }: Props) {
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
  const found = lookup.state === "done" ? lookup.replacement : null;
  const target = targetFor(r, choice, found);
  const lines = target && docs.length ? patchPreview(docs, r, target) : [];
  const resurrectable = RESURRECTABLE.has(r.cls);
  const busy = lookup.state === "loading";

  function pick(c: Choice) {
    if (c === choice) return;
    onChoice(r!.url, c);
    if (c !== "keep" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRising(true);
      setTimeout(() => setRising(false), 900);
    }
  }

  const options: Array<{ value: Choice; label: string; note: string; disabled: boolean }> = [
    {
      value: "snapshot",
      label: "Wayback snapshot",
      note: snap ? `the copy from ${fmtTs(snap.timestamp)}` : "no archived copy exists",
      disabled: !snap,
    },
    {
      value: "replacement",
      label: "Living replacement",
      note: found ? found.url : "find one with the button above",
      disabled: !found,
    },
    { value: "keep", label: "Keep as is", note: "the patch leaves this link alone", disabled: false },
  ];

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
              <p>The Wayback Machine never captured this page, so there is nothing to bring back. Keep it, or look for a living replacement below.</p>
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

      {resurrectable && (
        <section className="seance-find" aria-label="A living replacement">
          <p className="pane-tag">A living replacement</p>
          <div className="find-row">
            <button type="button" className="btn btn-quiet" onClick={() => onLookup(r.url)} disabled={busy || lookup.state === "done"} aria-describedby="find-result">
              {busy ? "Searching the living web…" : lookup.state === "done" ? "Searched" : "Look for a living replacement"}
            </button>
            <p className="hint find-hint">Asks the site, GitHub and its sitemap once. Nothing is searched until you press.</p>
          </div>
          <div id="find-result" className="find-result" role="status">
            {busy && <span>Listening for a heartbeat…</span>}
            {lookup.state === "error" && <span className="find-error">{lookup.message}</span>}
            {lookup.state === "done" && !found && <span>No living replacement found{lookup.timedOut ? ". The search ran out of time before it could say for sure" : ""}.</span>}
            {found && (
              <dl className="find-found">
                <div>
                  <dt>Found alive</dt>
                  <dd>
                    <a className="mono" href={found.url} target="_blank" rel="noopener noreferrer nofollow">
                      {found.url}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>How we found it</dt>
                  <dd>{reasonText(found.reason)}</dd>
                </div>
                <div>
                  <dt>Sure</dt>
                  <dd>{Math.round(found.confidence * 100)}%</dd>
                </div>
              </dl>
            )}
          </div>
          {canPatch && (
            <div className="choice" role="radiogroup" aria-labelledby="choice-h">
              <p className="pane-tag" id="choice-h">
                What the patch does with this link
              </p>
              {options.map((o) => (
                <label key={o.value} className={`choice-opt${o.disabled ? " is-off" : ""}${choice === o.value ? " is-on" : ""}`}>
                  <input type="radio" name="seance-choice" value={o.value} checked={choice === o.value} disabled={o.disabled} onChange={() => pick(o.value)} />
                  <span className="choice-label">{o.label}</span>
                  <span className="choice-note">{o.note}</span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

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

      {canPatch && resurrectable && choice === "keep" && (
        <p className="seance-kept hint">Kept as is: the patch will not touch this link.</p>
      )}

      <footer className="seance-foot">
        {snap && (
          <a className="btn btn-quiet" href={snap.url} target="_blank" rel="noopener noreferrer">
            Open in the Wayback Machine ↗
          </a>
        )}
        <span className="grow" />
        <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()} autoFocus>
          {canPatch && resurrectable ? "Done" : "Close"}
        </button>
      </footer>
      <div className="seance-rise" aria-hidden="true">
        <SpiritIcon cls="living" size={80} />
      </div>
    </dialog>
  );
}
