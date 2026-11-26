import { LINK_CLASSES, type LinkClass } from "../../lib/classify/classify";

export type ActionInputs = {
  paths: string[];
  maxFiles: number;
  failOn: Set<LinkClass>;
  citeDates: "git" | "none";
};
export type ParsedInputs = { ok: true; value: ActionInputs } | { ok: false; message: string };

const FAIL_CLASSES = LINK_CLASSES.filter((c) => c !== "living");
const MAX_FILES_LIMIT = 50;

/** GitHub passes input `max-files` as INPUT_MAX-FILES (upper-cased, hyphen kept). */
const read = (env: Record<string, string | undefined>, name: string, fallback: string): string => {
  const v = env[`INPUT_${name.toUpperCase()}`];
  return v === undefined ? fallback : v;
};

export function parseInputs(env: Record<string, string | undefined>): ParsedInputs {
  const paths = read(env, "paths", "**/*.md")
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paths.length) return { ok: false, message: "Input `paths` is empty. Use a glob such as **/*.md." };
  if (paths.some((p) => p.replace(/^!/, "").split("/").includes(".."))) {
    return { ok: false, message: "Input `paths` may not contain `..`: the check only reads inside the workspace." };
  }

  const rawMax = read(env, "max-files", "20").trim();
  const maxFiles = /^\d+$/.test(rawMax) ? Number(rawMax) : NaN;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_FILES_LIMIT) {
    return { ok: false, message: `Input \`max-files\` must be a whole number from 1 to ${MAX_FILES_LIMIT}.` };
  }

  const failOn = new Set<LinkClass>();
  for (const word of read(env, "fail-on", "tombstone,zombie").split(/[\s,]+/).filter(Boolean)) {
    const c = word.toLowerCase();
    if (!(FAIL_CLASSES as readonly string[]).includes(c)) {
      return { ok: false, message: `Input \`fail-on\` has an unknown class "${word.slice(0, 40)}". Use any of: ${FAIL_CLASSES.join(", ")}.` };
    }
    failOn.add(c as LinkClass);
  }

  const cite = read(env, "cite-dates", "git").trim().toLowerCase();
  if (cite !== "git" && cite !== "none") return { ok: false, message: "Input `cite-dates` must be `git` or `none`." };

  return { ok: true, value: { paths, maxFiles, failOn, citeDates: cite } };
}
