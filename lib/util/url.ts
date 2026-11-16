/** Trailing characters that are almost never part of a URL written in prose. */
const TRAILING_PUNCT = /[.,;:!?'"*_~]+$/;

/** Trim prose punctuation and unbalanced closing brackets from a bare URL. */
export function trimBareUrl(raw: string): string {
  let s = raw.replace(TRAILING_PUNCT, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"]] as const) {
    while (s.endsWith(close) && count(s, open) < count(s, close)) {
      s = s.slice(0, -1).replace(TRAILING_PUNCT, "");
    }
  }
  return s;
}

function count(s: string, ch: string) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Canonical form used for de-duplication and cache keys:
 * lower-case scheme/host (WHATWG URL does this), no default port, no fragment,
 * no trailing dot on host, empty path becomes "/". Query and path are kept as-is
 * (paths are case-sensitive on most servers). Idempotent: canon(canon(x)) === canon(x).
 */
export function canonicalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  u.hash = "";
  if (u.hostname.endsWith(".")) u.hostname = u.hostname.replace(/\.+$/, "");
  if (!u.hostname) return null;
  if (!u.search) u.search = ""; // drops a bare trailing "?"
  const out = u.href;
  // Re-parse once to guarantee a fixed point for odd inputs.
  const again = new URL(out);
  again.hash = "";
  return again.href;
}

export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Build a Wayback Machine replay URL. `id_` returns the original bytes without the toolbar. */
export function waybackUrl(timestamp: string, url: string, raw = false): string {
  return `https://web.archive.org/web/${timestamp}${raw ? "id_" : ""}/${url}`;
}
