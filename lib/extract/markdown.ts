import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { canonicalUrl } from "../util/url";

export type LinkKind = "inline" | "image" | "definition" | "autolink" | "literal" | "html";

export type LinkOccurrence = {
  /** URL as the parser resolved it (escapes decoded, www. literals given a scheme) */
  url: string;
  /** canonical form used for de-duplication */
  canonical: string;
  /** exact source text that holds the URL; replacing [start,end) patches it */
  raw: string;
  start: number;
  end: number;
  line: number;
  kind: LinkKind;
};

type Node = {
  type: string;
  url?: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number } };
};

/** Parse a link destination starting at `i`: returns [start,end) of the raw destination text. */
function scanDestination(src: string, i: number, limit: number): [number, number] | null {
  while (i < limit && /[ \t\n]/.test(src[i])) i++;
  if (i >= limit) return null;
  if (src[i] === "<") {
    const close = src.indexOf(">", i + 1);
    if (close === -1 || close > limit) return null;
    return [i + 1, close];
  }
  let depth = 0;
  let j = i;
  for (; j < limit; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (/\s/.test(c)) break;
  }
  return j > i ? [i, j] : null;
}

function lineAt(src: string, offset: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const HTML_ATTR = /\b(?:href|src)\s*=\s*(["'])(https?:\/\/[^"'\s<>]+)\1/gi;

/** Extract every absolute http(s) link in a Markdown document with exact source spans. */
export function extractMarkdownLinks(src: string): LinkOccurrence[] {
  const tree = fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as unknown as Node;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const out: LinkOccurrence[] = [];

  const push = (url: string, start: number, end: number, kind: LinkKind) => {
    const canonical = canonicalUrl(url);
    if (!canonical || start < 0 || end <= start) return;
    out.push({ url, canonical, raw: src.slice(start, end), start, end, line: lineAt(src, start, lineStarts), kind });
  };

  const visit = (node: Node) => {
    const s = node.position?.start.offset;
    const e = node.position?.end.offset;
    if (s !== undefined && e !== undefined) {
      if (node.type === "link" && node.url) {
        if (src[s] === "<" && src[e - 1] === ">") {
          push(node.url, s + 1, e - 1, "autolink");
        } else if (src[s] === "[") {
          const kids = node.children ?? [];
          const labelEnd = kids.length ? (kids[kids.length - 1].position?.end.offset ?? s + 1) : s + 1;
          const open = src.indexOf("](", labelEnd);
          if (open !== -1 && open < e) {
            const span = scanDestination(src, open + 2, e);
            if (span) push(node.url, span[0], span[1], "inline");
          }
        } else {
          push(node.url, s, e, "literal");
        }
      } else if (node.type === "image" && node.url) {
        const open = src.indexOf("](", s + 2);
        if (open !== -1 && open < e) {
          const span = scanDestination(src, open + 2, e);
          if (span) push(node.url, span[0], span[1], "image");
        }
      } else if (node.type === "definition" && node.url) {
        const colon = src.indexOf("]:", s);
        if (colon !== -1 && colon < e) {
          const span = scanDestination(src, colon + 2, e);
          if (span) push(node.url, span[0], span[1], "definition");
        }
      } else if (node.type === "html" && node.value) {
        HTML_ATTR.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = HTML_ATTR.exec(node.value))) {
          const urlStart = s + m.index + m[0].indexOf(m[2], m[0].indexOf(m[1]));
          if (src.slice(urlStart, urlStart + m[2].length) === m[2]) push(m[2].replace(/&amp;/g, "&"), urlStart, urlStart + m[2].length, "html");
        }
      }
    }
    for (const c of node.children ?? []) visit(c);
  };
  visit(tree);
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Pasted input that is not Markdown at all (one URL per line, CSV...) still works via GFM literals. */
export function extractFromText(src: string): LinkOccurrence[] {
  return extractMarkdownLinks(src);
}
