/** Removes a GitHub token, and anything shaped like one, from text (fix-it R1.10, R1.11). */

const MARK = "[redacted]";
const SHAPED = /gh[pousr]_\w{20,}|github_pat_\w{20,}/g;
const MAX_MESSAGE = 300;

/**
 * Replace the given token and any GitHub-token-shaped string with `[redacted]`.
 * Idempotent (existing markers are left alone) and never throws.
 */
export function redactToken(text: string, token?: string): string {
  try {
    if (typeof text !== "string") return "";
    const tok = typeof token === "string" && token.length > 0 ? token : "";
    return text
      .split(MARK)
      .map((seg) => {
        if (tok) seg = seg.split(tok).join(MARK);
        return seg.replace(SHAPED, MARK);
      })
      .join(MARK);
  } catch {
    return MARK;
  }
}

function describe(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/** Turn any thrown value into one short line (at most 300 characters) with no token in it. */
export function safeMessage(err: unknown, token?: string): string {
  let raw = "";
  try {
    raw = describe(err);
  } catch {
    raw = "";
  }
  // eslint-disable-next-line no-control-regex
  raw = raw.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (!raw) raw = "Something went wrong.";
  const clean = redactToken(raw, token);
  return clean.length <= MAX_MESSAGE ? clean : `${clean.slice(0, MAX_MESSAGE - 1)}…`;
}
