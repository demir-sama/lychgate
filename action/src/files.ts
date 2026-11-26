import { readdir } from "node:fs/promises";
import path from "node:path";
import { rankMarkdownPaths } from "../../lib/github/repo";
import { readInsideCwd } from "../../packages/lychgate-mcp/src/tools";
import type { Doc } from "../../lib/scan/types";

const SKIP_DIR = new Set(["node_modules", ".git", "vendor", "dist", "build", "third_party"]);
const MD = /\.(md|markdown)$/i;
const MAX_WALK = 20_000;
const MAX_BYTES = 3 * 1024 * 1024;

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** `**`, `*`, `?`; `/` separators; no braces. A path with a `..` segment never matches. */
export function matchGlob(pattern: string, p: string): boolean {
  if (p.split("/").includes("..")) return false;
  return globToRegExp(pattern.replace(/^\.\//, "")).test(p);
}

/** Positive patterns include (none = everything), `!` patterns exclude. */
export function matchPaths(paths: string[], patterns: string[]): string[] {
  const pos = patterns.filter((p) => !p.startsWith("!"));
  const neg = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  return paths.filter((p) => (!pos.length || pos.some((g) => matchGlob(g, p))) && !neg.some((g) => matchGlob(g, p)));
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [""];
  while (stack.length && out.length < MAX_WALK) {
    const rel = stack.pop()!;
    const entries = await readdir(path.join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // never followed, never read
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) stack.push(child);
      } else if (e.isFile() && MD.test(e.name)) out.push(child);
    }
  }
  return out;
}

/** Markdown files under `root` that match `patterns`, ranked README first, cut at `max`. */
export async function findMarkdown(root: string, patterns: string[], max: number): Promise<{ files: Doc[]; warnings: string[] }> {
  const warnings: string[] = [];
  const all = await walk(root);
  const wanted = rankMarkdownPaths(matchPaths(all, patterns), undefined, max);
  const matched = matchPaths(all, patterns).length;
  if (matched > wanted.length) warnings.push(`Found ${matched} Markdown files; checking the first ${wanted.length} (max-files).`);
  const files: Doc[] = [];
  let bytes = 0;
  for (const p of wanted) {
    try {
      const f = await readInsideCwd(p, root);
      bytes += f.text.length;
      if (bytes > MAX_BYTES) {
        warnings.push("Stopped reading files after 3 MB of Markdown.");
        break;
      }
      files.push({ path: f.rel, content: f.text });
    } catch {
      warnings.push(`Skipped ${p}: it could not be read inside the workspace.`);
    }
  }
  return { files, warnings };
}
