"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LinkClass } from "@/lib/classify/classify";
import { patchMarkdown, unifiedDiff } from "@/lib/patch/patch";
import type { Doc, LinkResult, ScanEvent, ScanSummary } from "@/lib/scan/types";
import { GateScene } from "./graveyard/GateScene";
import { GraveCard, graveId } from "./graveyard/GraveCard";
import { HealthGauge } from "./graveyard/HealthGauge";
import { SpiritIcon } from "./graveyard/icons";
import { Plot } from "./graveyard/Plot";
import { DEFAULT_RESURRECT, ORDER, RESURRECTABLE, SPIRITS, fmtTs } from "./graveyard/spirits";

type Mode = "github" | "site" | "markdown";
const MODES: Array<[Mode, string]> = [
  ["github", "GitHub repo"],
  ["site", "Website"],
  ["markdown", "Markdown"],
];

const SAMPLE_MD = `# Reading list

- [dtach](https://github.com/bogner/dtach)
- [HTML 4.01 spec](https://www.w3.org/TR/html4/)
- [A page that never existed](https://www.w3.org/this/page/was/never/here)
- [Unregistered domain](https://lychgate-demo-unregistered-domain-example.com/docs)
- [Cloud metadata (refused)](http://169.254.169.254/latest/meta-data/)
`;

const PRESETS: Array<{ label: string; mode: Mode; value: string }> = [
  { label: "the-art-of-command-line", mode: "github", value: "jlevy/the-art-of-command-line" },
  { label: "sindresorhus/awesome", mode: "github", value: "sindresorhus/awesome" },
  { label: "a haunted reading list", mode: "markdown", value: SAMPLE_MD },
];

const BESTIARY: LinkClass[] = ["living", "tombstone", "ghost", "drifted", "zombie"];

function download(name: string, content: string, type = "text/markdown") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Scanner() {
  const [mode, setMode] = useState<Mode>("github");
  const [repo, setRepo] = useState("jlevy/the-art-of-command-line");
  const [site, setSite] = useState("");
  const [sitemap, setSitemap] = useState(false);
  const [md, setMd] = useState(SAMPLE_MD);
  const [citeDate, setCiteDate] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<LinkResult[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [filter, setFilter] = useState<LinkClass | "all">("all");
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [openGrave, setOpenGrave] = useState<string | null>(null);
  const [daylight, setDaylight] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Theme: persisted; defaults to Daylight for users who ask for more contrast.
  useEffect(() => {
    const saved = localStorage.getItem("lychgate:daylight");
    if (saved === "1" || (saved === null && window.matchMedia?.("(prefers-contrast: more)").matches)) setDaylight(true);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = daylight ? "daylight" : "night";
    localStorage.setItem("lychgate:daylight", daylight ? "1" : "0");
  }, [daylight]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<LinkClass, number>;
    for (const r of results) c[r.cls]++;
    return c;
  }, [results]);
  const scored = counts.living + counts.drifted + counts.tombstone + counts.ghost + counts.zombie;
  const health = summary?.health ?? (scored ? Math.round(((counts.living + counts.drifted * 0.5) / scored) * 100) : 100);
  const started = running || results.length > 0 || total > 0;

  // Fog density follows health: a healthy site has a clear night.
  useEffect(() => {
    const fog = started ? Math.max(0.12, (100 - health) / 100) : 0.35;
    document.documentElement.style.setProperty("--fog", fog.toFixed(2));
  }, [health, started]);

  const sorted = useMemo(
    () => results.filter((r) => filter === "all" || r.cls === filter).sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || b.confidence - a.confidence),
    [results, filter],
  );

  const replacements = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of results) if (r.snapshot && RESURRECTABLE.has(r.cls) && chosen[r.url]) m.set(r.url, r.snapshot.url);
    return m;
  }, [results, chosen]);

  const patched = useMemo(() => docs.map((d) => ({ doc: d, ...patchMarkdown(d.content, replacements) })), [docs, replacements]);
  const changedCount = patched.reduce((n, p) => n + p.changed.length, 0);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setError("");
    setWarnings([]);
    setResults([]);
    setDocs([]);
    setTotal(0);
    setSummary(null);
    setChosen({});
    setFilter("all");
    setOpenGrave(null);
    setStatus("Opening the gate…");
    const body =
      mode === "github" ? { kind: "github", repo } : mode === "site" ? { kind: "site", url: site, sitemap, citeDate } : { kind: "markdown", text: md, citeDate };
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      // Batch results per animation frame so a fast burst doesn't re-render 300 times.
      let batch: LinkResult[] = [];
      let raf = 0;
      const flush = () => {
        raf = 0;
        const b = batch;
        batch = [];
        setResults((prev) => [...prev, ...b]);
        setChosen((c) => {
          const n = { ...c };
          for (const r of b) if (r.snapshot && DEFAULT_RESURRECT.has(r.cls)) n[r.url] = true;
          return n;
        });
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as ScanEvent;
          if (ev.type === "status") setStatus(ev.message);
          else if (ev.type === "meta") {
            setSource(ev.source);
            setTotal(ev.total);
            setDocs(ev.docs);
            setWarnings(ev.warnings);
            setStatus(ev.total ? `Walking ${ev.total} graves…` : "No links found.");
          } else if (ev.type === "result") {
            batch.push(ev.result);
            if (!raf) raf = requestAnimationFrame(flush);
          } else if (ev.type === "done") {
            if (raf) cancelAnimationFrame(raf);
            flush();
            setSummary(ev.summary);
            setStatus(`The gate is closed. ${ev.summary.total} links checked in ${(ev.ms / 1000).toFixed(1)}s.`);
          } else if (ev.type === "error") setError(ev.message);
        }
      }
      if (raf) {
        cancelAnimationFrame(raf);
        flush();
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") setStatus("Scan stopped.");
      else setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function downloadDiff() {
    const diff = patched
      .map((p) => unifiedDiff(p.doc.path, p.doc.content, p.content))
      .filter(Boolean)
      .join("\n");
    download("lychgate.diff", diff || "# no changes selected\n", "text/x-diff");
  }

  function reportMarkdown() {
    const lines = [`# Lychgate report: ${source}`, "", `Health ${health}/100 · ${results.length} links`, ""];
    for (const r of sorted) {
      lines.push(`- **${SPIRITS[r.cls].label}** ${r.url}${r.snapshot ? ` → [snapshot ${fmtTs(r.snapshot.timestamp)}](${r.snapshot.url})` : ""}`);
      lines.push(`  - ${r.reasons.join(" ")}`);
    }
    return lines.join("\n") + "\n";
  }

  function prDescription() {
    const fixed = results.filter((r) => replacements.has(r.url));
    const lines = [
      "## Resurrect dead links",
      "",
      `Lychgate found ${counts.tombstone + counts.ghost + counts.zombie} dead or unsafe links in ${source} (health ${health}/100). This PR points ${fixed.length} of them at the Wayback Machine snapshot closest to when each link was cited.`,
      "",
      "| Link | Diagnosis | Snapshot |",
      "|---|---|---|",
      ...fixed.map((r) => `| ${r.url} | ${SPIRITS[r.cls].label}: ${r.reasons[0].replace(/\|/g, "\\|")} | [${fmtTs(r.snapshot!.timestamp)}](${r.snapshot!.url}) |`),
      "",
      "_Checked with [Lychgate](https://github.com/demir-sama/lychgate)._",
    ];
    return lines.join("\n") + "\n";
  }

  async function copyPr() {
    try {
      await navigator.clipboard.writeText(prDescription());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      download("pr-description.md", prDescription());
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setMode(p.mode);
    if (p.mode === "github") setRepo(p.value);
    else if (p.mode === "markdown") setMd(p.value);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const focusGrave = useCallback((url: string, open = true) => {
    const el = document.getElementById(graveId(url));
    if (!el) return;
    if (open) setOpenGrave(url);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  // Keyboard: "/" focuses the input, j/k walk the graves, Esc closes evidence.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, select, [contenteditable=true]");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "k") {
        const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(":scope > .grave") ?? []);
        if (!items.length) return;
        const cur = items.findIndex((el) => el.contains(document.activeElement));
        const next = e.key === "j" ? Math.min(items.length - 1, cur + 1) : Math.max(0, cur === -1 ? 0 : cur - 1);
        e.preventDefault();
        items[next].focus();
        items[next].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && t.classList.contains("grave")) {
        const url = sorted.find((r) => graveId(r.url) === t.id)?.url;
        if (url) setOpenGrave((o) => (o === url ? null : url));
      } else if (e.key === "Escape") setOpenGrave(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sorted]);

  function onTabKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = MODES[(i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length][0];
    setMode(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  const progress = total ? Math.round((results.length / total) * 100) : 0;
  const dead = counts.tombstone + counts.ghost + counts.zombie;

  return (
    <>
      <div className="topbar">
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
        <button type="button" className="btn btn-quiet theme-toggle" aria-pressed={daylight} onClick={() => setDaylight((d) => !d)}>
          <span aria-hidden="true">{daylight ? "☾" : "☀"}</span> {daylight ? "Night" : "Daylight"} mode
        </button>
      </div>

      <header className="hero">
        <GateScene open={running} />
        <div className="hero-copy">
          <p className="eyebrow">Kiroween 2026 · a link checker in costume</p>
          <h1>
            Every dead link,
            <br />
            <em>and how it died.</em>
          </h1>
          <p className="lede">Lychgate walks your docs, names each broken link&rsquo;s cause of death, and brings it back from the Wayback Machine copy closest to the day you cited it.</p>
        </div>
      </header>

      <main className="shell" id="main">
        <form onSubmit={scan} className="gate" aria-label="Scan links">
          <div role="tablist" aria-label="What to scan" className="tabs">
            {MODES.map(([m, label], i) => (
              <button
                key={m}
                type="button"
                role="tab"
                id={`tab-${m}`}
                aria-selected={mode === m}
                aria-controls="gate-panel"
                tabIndex={mode === m ? 0 : -1}
                className="tab"
                onClick={() => setMode(m)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="gate-panel" aria-labelledby={`tab-${mode}`} className="panel">
            {mode === "github" && (
              <>
                <label htmlFor="repo">Public repository</label>
                <div className="field">
                  <span className="field-pre" aria-hidden="true">github.com/</span>
                  <input ref={inputRef} id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" required autoComplete="off" spellCheck={false} aria-describedby="repo-hint" />
                </div>
                <p className="hint" id="repo-hint">
                  Up to 20 Markdown files, README first. Git history dates each link, so we can find the snapshot from the day it was added.
                </p>
              </>
            )}
            {mode === "site" && (
              <>
                <label htmlFor="site">Page or sitemap URL</label>
                <input ref={inputRef} id="site" type="url" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://example.com/blog/post" required autoComplete="url" spellCheck={false} />
                <label className="check">
                  <input type="checkbox" checked={sitemap} onChange={(e) => setSitemap(e.target.checked)} /> Also read /sitemap.xml (up to 12 pages)
                </label>
              </>
            )}
            {mode === "markdown" && (
              <>
                <label htmlFor="md">Markdown, or one URL per line</label>
                <textarea ref={inputRef} id="md" value={md} onChange={(e) => setMd(e.target.value)} rows={7} required spellCheck={false} />
              </>
            )}
            {mode !== "github" && (
              <div className="inline">
                <label htmlFor="cite">Links cited on</label>
                <input id="cite" type="date" value={citeDate} onChange={(e) => setCiteDate(e.target.value)} aria-describedby="cite-hint" />
                <span className="hint" id="cite-hint">
                  Optional. Turns on drift and takeover checks against that date.
                </span>
              </div>
            )}
          </div>

          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={running}>
              <span className="btn-lantern" aria-hidden="true" />
              {running ? "Raising the dead…" : "Open the gate"}
            </button>
            {running && (
              <button type="button" className="btn btn-quiet" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            )}
            <span className="presets">
              Try{" "}
              {PRESETS.map((p, i) => (
                <span key={p.label}>
                  <button type="button" className="linkish" onClick={() => applyPreset(p)}>
                    {p.label}
                  </button>
                  {i < PRESETS.length - 1 ? ", " : ""}
                </span>
              ))}
            </span>
          </div>
          <p className="kbd-hint">
            <kbd>/</kbd> focus · <kbd>j</kbd>
            <kbd>k</kbd> walk the graves · <kbd>Enter</kbd> evidence · <kbd>Esc</kbd> close
          </p>
        </form>

        <div className="live" aria-live="polite" aria-atomic="false">
          {status && (
            <p className={`status ${running ? "is-running" : ""}`}>
              {running && <span className="wisp" aria-hidden="true" />}
              {status}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
        </div>

        {!started && (
          <section className="bestiary" aria-labelledby="bestiary-h">
            <h2 id="bestiary-h">Five ways a link dies</h2>
            <ul>
              {BESTIARY.map((k, i) => (
                <li key={k} className={`beast c-${k}`} style={{ ["--i" as string]: i }}>
                  <SpiritIcon cls={k} size={34} />
                  <h3>{SPIRITS[k].label}</h3>
                  <p>{SPIRITS[k].blurb}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {started && total > 0 && (
          <section className="yard" aria-labelledby="yard-h">
            <div className="yard-head">
              <HealthGauge health={health} settled={!!summary} />
              <div className="yard-title">
                <h2 id="yard-h">{source}</h2>
                <p>
                  {results.length} of {total} checked
                  {dead > 0 ? ` · ${dead} dead or unsafe` : ""}
                  {summary ? "" : "…"}
                </p>
                <div className="progress" aria-hidden="true">
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            <Plot results={results} total={total} onPick={(u) => focusGrave(u)} />

            <div className="chips" role="group" aria-label="Filter graves">
              <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All <span className="n">{results.length}</span>
              </button>
              {ORDER.filter((k) => counts[k] > 0 || BESTIARY.includes(k)).map((k) => (
                <button key={k} type="button" className={`chip c-${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)} title={SPIRITS[k].blurb} disabled={counts[k] === 0}>
                  <SpiritIcon cls={k} size={16} /> {SPIRITS[k].plural} <span className="n">{counts[k]}</span>
                </button>
              ))}
            </div>

            {summary && (
              <div className="exports" role="region" aria-label="Leave with the fix">
                <div>
                  <h3>Leave with the fix</h3>
                  <p>
                    {docs.length
                      ? `${changedCount} link${changedCount === 1 ? "" : "s"} marked for resurrection across ${patched.filter((p) => p.changed.length).length} file${patched.filter((p) => p.changed.length).length === 1 ? "" : "s"}.`
                      : "Website scans give a report; paste Markdown or scan a repo to get a patch."}
                  </p>
                </div>
                <div className="export-btns">
                  {patched
                    .filter((p) => p.changed.length > 0)
                    .slice(0, 4)
                    .map((p) => (
                      <button key={p.doc.path} type="button" className="btn btn-quiet" onClick={() => download(p.doc.path.split("/").pop() ?? "patched.md", p.content)}>
                        ↓ {p.doc.path}
                      </button>
                    ))}
                  {docs.length > 0 && (
                    <>
                      <button type="button" className="btn btn-quiet" onClick={downloadDiff} disabled={!changedCount}>
                        ↓ Unified diff
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={copyPr} disabled={!changedCount}>
                        {copied ? "Copied ✓" : "Copy PR description"}
                      </button>
                    </>
                  )}
                  <button type="button" className="btn btn-quiet" onClick={() => download("lychgate-report.md", reportMarkdown())}>
                    ↓ Report
                  </button>
                </div>
              </div>
            )}

            <ol className="graves" ref={listRef} aria-label="Checked links, worst first">
              {sorted.map((r) => (
                <GraveCard
                  key={r.url}
                  r={r}
                  canPatch={docs.length > 0}
                  chosen={!!chosen[r.url]}
                  onChoose={(v) => setChosen((c) => ({ ...c, [r.url]: v }))}
                  open={openGrave === r.url}
                  onToggle={(v) => setOpenGrave((o) => (v ? r.url : o === r.url ? null : o))}
                />
              ))}
            </ol>
            {sorted.length === 0 && results.length > 0 && <p className="empty">No {filter === "all" ? "" : SPIRITS[filter as LinkClass].plural.toLowerCase()} here.</p>}
          </section>
        )}
      </main>
    </>
  );
}
