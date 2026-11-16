"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LinkClass } from "@/lib/classify/classify";
import { patchMarkdown, unifiedDiff } from "@/lib/patch/patch";
import type { Doc, LinkResult, ScanEvent, ScanSummary } from "@/lib/scan/types";

type Mode = "github" | "site" | "markdown";

export const SPIRITS: Record<LinkClass, { label: string; icon: string; blurb: string }> = {
  living: { label: "Living", icon: "🕯️", blurb: "Healthy" },
  tombstone: { label: "Tombstone", icon: "🪦", blurb: "404, 410 or the domain is gone" },
  ghost: { label: "Ghost", icon: "👻", blurb: "Soft-404: answers 200 but the page is gone" },
  drifted: { label: "Drifted", icon: "🌫️", blurb: "Live, but no longer says what was cited" },
  zombie: { label: "Zombie", icon: "🧟", blurb: "Domain parked or re-registered since it was cited (security risk)" },
  restless: { label: "Restless", icon: "🌀", blurb: "Couldn't confirm (bot-blocked, timeout or server error)" },
  sealed: { label: "Sealed", icon: "🔒", blurb: "Refused: private or internal address" },
};
const ORDER: LinkClass[] = ["zombie", "tombstone", "ghost", "drifted", "restless", "sealed", "living"];
const DEFAULT_RESURRECT = new Set<LinkClass>(["tombstone", "ghost", "zombie"]);
const RESURRECTABLE = new Set<LinkClass>(["tombstone", "ghost", "zombie", "drifted"]);

const SAMPLE_MD = `# Reading list

- [Pew: When Online Content Disappears](https://www.pewresearch.org/data-labs/2024/05/17/when-online-content-disappears/)
- [Google Reader](http://www.google.com/reader/)
- [Yahoo! GeoCities](http://geocities.com/)
- [A page that never existed](https://www.w3.org/this/page/was/never/here)
- https://www.w3.org/TR/html4/
`;

function fmtDate(iso?: string) {
  return iso ? iso.slice(0, 10) : "unknown";
}
function fmtTs(ts: string) {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

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
  const [daylight, setDaylight] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

  const sorted = useMemo(
    () => [...results].filter((r) => filter === "all" || r.cls === filter).sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || b.confidence - a.confidence),
    [results, filter],
  );

  const replacements = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of results) if (r.snapshot && RESURRECTABLE.has(r.cls) && chosen[r.url]) m.set(r.url, r.snapshot.url);
    return m;
  }, [results, chosen]);

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
    setSummary(null);
    setChosen({});
    setFilter("all");
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
            setStatus(`Checking ${ev.total} links…`);
          } else if (ev.type === "result") {
            const r = ev.result;
            setResults((prev) => [...prev, r]);
            if (r.snapshot && DEFAULT_RESURRECT.has(r.cls)) setChosen((c) => ({ ...c, [r.url]: true }));
          } else if (ev.type === "done") {
            setSummary(ev.summary);
            setStatus(`Done in ${(ev.ms / 1000).toFixed(1)}s.`);
          } else if (ev.type === "error") setError(ev.message);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function patchedDocs() {
    return docs.map((d) => ({ ...d, ...patchMarkdown(d.content, replacements) }));
  }

  function downloadPatched(d: Doc) {
    const p = patchMarkdown(d.content, replacements);
    download(d.path.split("/").pop() ?? "patched.md", p.content);
  }

  function downloadDiff() {
    const diff = patchedDocs()
      .map((p) => unifiedDiff(p.path, docs.find((d) => d.path === p.path)!.content, p.content))
      .filter(Boolean)
      .join("\n");
    download("lychgate.diff", diff || "# no changes selected\n", "text/x-diff");
  }

  function downloadReport() {
    const lines = [`# Lychgate report: ${source}`, "", `Health: ${health}/100 · ${results.length} links`, ""];
    for (const r of sorted) {
      lines.push(`- **${SPIRITS[r.cls].label}** ${r.url}${r.snapshot ? ` → [snapshot ${fmtTs(r.snapshot.timestamp)}](${r.snapshot.url})` : ""}`);
      lines.push(`  - ${r.reasons.join(" ")}`);
    }
    download("lychgate-report.md", lines.join("\n") + "\n");
  }

  const done = !!summary;
  const changedCount = docs.length ? patchedDocs().reduce((n, p) => n + p.changed.length, 0) : 0;

  return (
    <section className="scanner" aria-label="Scan links">
      <div className="toolbar">
        <button type="button" className="ghostbtn" aria-pressed={daylight} onClick={() => setDaylight((d) => !d)}>
          {daylight ? "🌙 Night mode" : "☀️ Daylight mode"}
        </button>
      </div>

      <form onSubmit={scan} className="gate">
        <div role="tablist" aria-label="What to scan" className="tabs">
          {(
            [
              ["github", "GitHub repo"],
              ["site", "Website"],
              ["markdown", "Paste Markdown"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} aria-controls={`panel-${m}`} id={`tab-${m}`} className="tab" onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {mode === "github" && (
          <div role="tabpanel" id="panel-github" aria-labelledby="tab-github" className="panel">
            <label htmlFor="repo">Public repo</label>
            <input id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo or https://github.com/owner/repo" required autoComplete="off" spellCheck={false} />
            <p className="hint">We read up to 20 Markdown files (README first) and use git history to date each link.</p>
          </div>
        )}
        {mode === "site" && (
          <div role="tabpanel" id="panel-site" aria-labelledby="tab-site" className="panel">
            <label htmlFor="site">Page or sitemap URL</label>
            <input id="site" type="url" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://example.com/blog/post" required autoComplete="url" spellCheck={false} />
            <label className="check">
              <input type="checkbox" checked={sitemap} onChange={(e) => setSitemap(e.target.checked)} /> Also read /sitemap.xml (up to 12 pages)
            </label>
          </div>
        )}
        {mode === "markdown" && (
          <div role="tabpanel" id="panel-markdown" aria-labelledby="tab-markdown" className="panel">
            <label htmlFor="md">Markdown or a list of URLs</label>
            <textarea id="md" value={md} onChange={(e) => setMd(e.target.value)} rows={8} required spellCheck={false} />
          </div>
        )}
        {mode !== "github" && (
          <div className="panel inline">
            <label htmlFor="cite">Links cited on (optional)</label>
            <input id="cite" type="date" value={citeDate} onChange={(e) => setCiteDate(e.target.value)} />
            <span className="hint">Enables drift and takeover checks against that date.</span>
          </div>
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={running}>
            {running ? "Raising the dead…" : "Open the gate"}
          </button>
          {running && (
            <button type="button" className="ghostbtn" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>
      </form>

      <div className="live" aria-live="polite">
        {status && <p className="status">{status}</p>}
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

      {(results.length > 0 || running) && total > 0 && (
        <>
          <div className="fog" aria-label={`Health ${health} out of 100`}>
            <div className="fogbar" style={{ ["--health" as string]: `${health}%` }} />
            <p>
              <strong>{source}</strong> · health <strong>{health}</strong>/100 · {results.length}/{total} checked
            </p>
          </div>

          <div className="chips" role="group" aria-label="Filter by spirit">
            <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All <span>{results.length}</span>
            </button>
            {ORDER.map((k) => (
              <button key={k} type="button" className={`chip c-${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)} title={SPIRITS[k].blurb}>
                <span aria-hidden="true">{SPIRITS[k].icon}</span> {SPIRITS[k].label} <span>{counts[k]}</span>
              </button>
            ))}
          </div>

          {done && (
            <div className="exports">
              {docs.length > 0 ? (
                <>
                  <p>
                    {changedCount} link{changedCount === 1 ? "" : "s"} selected for resurrection.
                  </p>
                  {docs
                    .filter((d) => patchMarkdown(d.content, replacements).changed.length > 0)
                    .map((d) => (
                      <button key={d.path} type="button" className="ghostbtn" onClick={() => downloadPatched(d)}>
                        ⬇ Patched {d.path}
                      </button>
                    ))}
                  <button type="button" className="ghostbtn" onClick={downloadDiff}>
                    ⬇ Unified diff
                  </button>
                </>
              ) : null}
              <button type="button" className="ghostbtn" onClick={downloadReport}>
                ⬇ Report (.md)
              </button>
            </div>
          )}

          <ol className="graves">
            {sorted.map((r) => (
              <li key={r.url} className={`grave c-${r.cls}`}>
                <div className="gravehead">
                  <span className="badge" aria-label={`${SPIRITS[r.cls].label}: ${SPIRITS[r.cls].blurb}`}>
                    <span aria-hidden="true">{SPIRITS[r.cls].icon}</span> {SPIRITS[r.cls].label}
                  </span>
                  <a className="url" href={r.url} target="_blank" rel="noopener noreferrer nofollow">
                    {r.url}
                  </a>
                  <span className="conf" title="confidence">
                    {Math.round(r.confidence * 100)}%
                  </span>
                </div>
                <details>
                  <summary>Cause of death &amp; evidence</summary>
                  <ul className="evidence">
                    {r.reasons.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                    <li>
                      HTTP {r.status ?? "none"}
                      {r.redirects.length ? ` via ${r.redirects.length} redirect(s) to ${r.finalUrl}` : ""}
                      {r.title ? ` · title “${r.title.slice(0, 90)}”` : ""}
                    </li>
                    <li>
                      Cited: {fmtDate(r.citeDate)}
                      {r.citeSource === "git" ? " (from git history)" : r.citeSource === "user" ? " (you said)" : ""}
                      {r.drift !== undefined ? ` · ${Math.round(r.drift * 100)}% similar to the cited snapshot` : ""}
                      {r.rdapRegistered ? ` · domain registered ${fmtDate(r.rdapRegistered)}` : ""}
                    </li>
                    <li>
                      Found in:{" "}
                      {r.occurrences
                        .slice(0, 5)
                        .map((o) => (o.line ? `${o.doc}:${o.line}` : o.doc))
                        .join(", ")}
                      {r.occurrences.length > 5 ? ` +${r.occurrences.length - 5} more` : ""}
                    </li>
                  </ul>
                </details>
                {r.snapshot && (
                  <div className="snap">
                    <a href={r.snapshot.url} target="_blank" rel="noopener noreferrer">
                      Snapshot {fmtTs(r.snapshot.timestamp)}
                    </a>
                    <span className="hint">{r.snapshot.beforeCite ? " closest before it was cited" : " latest surviving copy"}</span>
                    {RESURRECTABLE.has(r.cls) && docs.length > 0 && (
                      <label className="check">
                        <input type="checkbox" checked={!!chosen[r.url]} onChange={(e) => setChosen((c) => ({ ...c, [r.url]: e.target.checked }))} /> Resurrect in patch
                      </label>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
