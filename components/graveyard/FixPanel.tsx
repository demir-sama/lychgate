"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_FIX_BODY, bodyBytes, buildFixBody, describeFixError, type FixPreview } from "@/lib/fix/panel";

type Props = {
  open: boolean;
  /** `owner/repo` recorded when the scan started, never the current value of the input. */
  repo: string;
  preview: FixPreview;
  onClose: () => void;
};

type Done = { url: string; number: number; files: number; links: number };

const TOKEN_PAGE = "https://github.com/settings/personal-access-tokens/new";

/**
 * "Open a pull request": a modal dialog that takes the person's own GitHub token for one request.
 * The token lives only in this component's state. It is cleared when the request ends and when the
 * dialog closes, and it is never written to storage, a cookie, the URL or the console (R4.4).
 * Native <dialog> gives the focus trap, Esc and the inert background.
 */
export function FixPanel({ open, repo, preview, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError("");
      setDone(null);
      setToken("");
      d.showModal();
      tokenRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (done) linkRef.current?.focus();
  }, [done]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    const body = buildFixBody(repo, token, preview);
    if (bodyBytes(body) > MAX_FIX_BODY) {
      setToken("");
      setError("There are too many links to send in one request. Use the downloads instead: the patched Markdown, the unified diff or the PR description.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (res.ok && typeof j.url === "string" && j.url.startsWith("https://github.com/")) {
        setDone({ url: j.url, number: Number(j.number) || 0, files: Number(j.files) || preview.files, links: Number(j.links) || preview.links });
      } else {
        setError(describeFixError(res.status, typeof j.error === "string" ? j.error : ""));
      }
    } catch {
      setError("Could not reach Lychgate. Check your connection and try again.");
    } finally {
      setBusy(false);
      setToken("");
    }
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <dialog
      ref={ref}
      className="fixpanel"
      aria-labelledby="fix-title"
      onClose={() => {
        setToken("");
        setError("");
        onClose();
      }}
    >
      <form onSubmit={submit} className="fix-form" autoComplete="off">
        <div className="fix-head">
          <h2 id="fix-title">Open a pull request</h2>
          <button type="button" className="btn btn-quiet fix-x" onClick={() => ref.current?.close()} aria-label="Close the pull request panel">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <p className="fix-counts">
          The pull request on <span className="mono">{repo}</span> will change {plural(preview.links, "link")} in {plural(preview.files, "file")}
          {preview.omittedFiles > 0 ? `; ${plural(preview.omittedFiles, "more file")} stay out because a pull request carries at most 20` : ""}. It goes to the default branch.
        </p>

        {done ? (
          <div className="fix-done" role="status">
            <p>The dead rest; review the pull request.</p>
            <a ref={linkRef} className="btn btn-primary" href={done.url} target="_blank" rel="noopener">
              Pull request{done.number ? ` #${done.number}` : ""} on GitHub ({plural(done.links, "link")}, {plural(done.files, "file")})
            </a>
          </div>
        ) : (
          <>
            <label htmlFor="fix-token">GitHub token</label>
            <input
              ref={tokenRef}
              id="fix-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              aria-describedby="fix-help fix-privacy"
              required
              minLength={20}
              maxLength={255}
            />
            <p className="hint" id="fix-help">
              Use a{" "}
              <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">
                fine-grained token
              </a>{" "}
              for this one repository with Contents read and write, and Pull requests read and write.
            </p>
            <p className="hint" id="fix-privacy">
              The token passes through the Lychgate server for this one request and is not stored.
            </p>
          </>
        )}

        <div className="fix-status" aria-live="polite">
          {busy ? "Opening the pull request…" : ""}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="fix-foot">
          {!done && (
            <button type="submit" className="btn btn-primary" disabled={busy || !token}>
              {busy ? "Opening…" : "Open the pull request"}
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
            {done ? "Close" : "Cancel"}
          </button>
        </div>
        {!done && <p className="hint">Without a token, the downloads and the PR description stay as they are.</p>}
      </form>
    </dialog>
  );
}
