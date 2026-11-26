import { execFile } from "node:child_process";
import { citeDatesFromHistory, type CommitInfo } from "../../lib/github/repo";

export type GitDates = { dates: Map<string, { date: string; exact: boolean; sha: string }>; warning?: string };

const HINT = "Use `actions/checkout` with `fetch-depth: 0` so the whole history is there.";

function git(bin: string, cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // execFile with an argument array: a file name can never become an option or a shell command.
    execFile(bin, args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/**
 * Cite dates for the raw link texts of one file, from the local git history
 * (same search as the website's GitHub scan). Any git trouble is a warning, never a crash.
 */
export async function citeDatesFromGit(root: string, file: string, urls: string[], opts: { git?: string } = {}): Promise<GitDates> {
  const bin = opts.git ?? "git";
  const none = (warning: string): GitDates => ({ dates: new Map(), warning });
  try {
    const shallow = (await git(bin, root, ["rev-parse", "--is-shallow-repository"])).trim();
    if (shallow === "true") return none(`The clone is shallow, so link ages are unknown and drift checks are skipped. ${HINT}`);
    const log = await git(bin, root, ["log", "--format=%H%x09%aI", "-n", "100", "--", file]);
    const commits: CommitInfo[] = log
      .split("\n")
      .map((l) => l.split("\t"))
      .filter((p) => p.length === 2 && p[0] && p[1])
      .map(([sha, date]) => ({ sha, date }));
    if (!commits.length) return { dates: new Map() };
    const dates = await citeDatesFromHistory(urls, commits, (sha) => git(bin, root, ["show", `${sha}:./${file}`]).catch(() => null));
    return { dates };
  } catch (err) {
    const code = (err as { code?: string }).code;
    const why = code === "ENOENT" ? "git is not installed on this runner" : "this is not a git checkout or git failed";
    return none(`Link ages are unknown because ${why}, so drift checks are skipped. ${HINT}`);
  }
}
