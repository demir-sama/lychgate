import { Parser } from "htmlparser2";

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head"]);

export type HtmlInfo = { title: string; text: string; links: string[]; metaRefresh?: string };

/** Single-pass HTML parse: title, visible-ish text, and href targets. */
export function parseHtml(html: string, baseUrl?: string): HtmlInfo {
  let title = "";
  let inTitle = false;
  let skipDepth = 0;
  const text: string[] = [];
  const links: string[] = [];
  let metaRefresh: string | undefined;
  let base = baseUrl;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "title") inTitle = true;
        if (SKIP_TEXT.has(name)) skipDepth++;
        if (name === "base" && attrs.href && baseUrl) {
          try {
            base = new URL(attrs.href, baseUrl).href;
          } catch {
            /* ignore */
          }
        }
        if (name === "a" && attrs.href) {
          const href = attrs.href.trim();
          if (base) {
            try {
              links.push(new URL(href, base).href);
            } catch {
              /* ignore */
            }
          } else links.push(href);
        }
        if (name === "meta" && (attrs["http-equiv"] ?? "").toLowerCase() === "refresh" && attrs.content) {
          const m = /url\s*=\s*['"]?([^'"]+)/i.exec(attrs.content);
          if (m) metaRefresh = m[1].trim();
        }
      },
      ontext(data) {
        if (inTitle) title += data;
        else if (skipDepth === 0) text.push(data);
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
        if (SKIP_TEXT.has(name) && skipDepth > 0) skipDepth--;
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  return {
    title: title.replace(/\s+/g, " ").trim(),
    text: text.join(" ").replace(/\s+/g, " ").trim(),
    links,
    metaRefresh,
  };
}

const WORD = /[\p{L}\p{N}]{3,}/gu;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).slice(0, 20_000);
}

/** Cosine similarity of term-frequency vectors. 1 = same vocabulary distribution. */
export function cosineSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const t of ta) fa.set(t, (fa.get(t) ?? 0) + 1);
  for (const t of tb) fb.set(t, (fb.get(t) ?? 0) + 1);
  let dot = 0;
  for (const [t, n] of fa) dot += n * (fb.get(t) ?? 0);
  let na = 0;
  let nb = 0;
  for (const n of fa.values()) na += n * n;
  for (const n of fb.values()) nb += n * n;
  const s = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.min(1, Math.max(0, s));
}

/** Ratio of the shorter to the longer length (0..1). */
export function lengthRatio(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  return Math.min(a, b) / Math.max(a, b);
}
