#!/usr/bin/env node
// Kiro hook (dogfood-doc-links): when a Markdown file is written, scan it through
// lychgate-mcp (scan_links { path }) and print Tombstone / Ghost / Zombie links with
// their suggested Wayback snapshot. Read-only: it never edits the file. It always
// exits 0 (missing build, non-Markdown file, scan failure and timeout are all quiet).
//
// Test seams (env): LYCHGATE_MCP_ENTRY overrides the server entry,
// LYCHGATE_HOOK_TIMEOUT_MS overrides the 90 s default.
import { existsSync } from "node:fs";
import path from "node:path";

const DEAD = new Set(["tombstone", "ghost", "zombie"]);
const cwd = process.cwd();

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

function writtenPath(event) {
  const a = event.tool_input ?? event.toolArgs ?? event.tool_args ?? {};
  const cands = [a.path, a.file_path, a.filePath, a.target, ...(Array.isArray(a.paths) ? a.paths : []), event.file_path, event.filePath, event.path, event.file];
  return cands.find((p) => typeof p === "string" && p.length > 0);
}

// Only the local-dev fake-IP switch is passed through (the server still ignores it in production).
function devEnv() {
  const env = { PATH: process.env.PATH ?? "" };
  if (process.env.LYCHGATE_DEV_ALLOW_FAKE_IP === "1") env.LYCHGATE_DEV_ALLOW_FAKE_IP = "1";
  return env;
}

async function main() {
  let event = {};
  try {
    event = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  const written = writtenPath(event);
  if (!written || !/\.(md|markdown)$/i.test(written)) return;

  const abs = path.resolve(cwd, written);
  const rel = path.relative(cwd, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return; // the server would refuse it anyway (R3.2)
  if (!existsSync(abs)) return;

  const entry = process.env.LYCHGATE_MCP_ENTRY || path.join(cwd, "packages/lychgate-mcp/dist/index.js");
  if (!existsSync(entry)) return;

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "lychgate-dogfood-hook", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], cwd, stderr: "ignore", env: devEnv() }));
  try {
    const res = await client.callTool({ name: "scan_links", arguments: { path: rel.split(path.sep).join("/") } });
    if (res.isError) return;
    const blocks = Array.isArray(res.content) ? res.content : [];
    const details = JSON.parse(blocks[1]?.text ?? "{}");
    const dead = (details.results ?? []).filter((r) => DEAD.has(r.cls));
    if (dead.length === 0) return;
    const out = [`lychgate: ${dead.length} dead link${dead.length === 1 ? "" : "s"} in ${rel}`];
    for (const r of dead) {
      const o = r.occurrences?.[0];
      const at = o ? ` (${rel}:${o.line})` : "";
      const label = r.cls[0].toUpperCase() + r.cls.slice(1);
      out.push(`- ${label}: ${r.url}${at}${r.snapshot ? `\n  snapshot: ${r.snapshot.url}` : "\n  snapshot: none found"}`);
    }
    out.push("Offer the patch to the person; do not edit the file without asking.");
    process.stdout.write(out.join("\n") + "\n");
  } finally {
    await client.close().catch(() => {});
  }
}

const limit = Number(process.env.LYCHGATE_HOOK_TIMEOUT_MS) || 90_000;
const timer = setTimeout(() => process.exit(0), limit);
timer.unref?.();
main()
  .catch(() => {})
  .finally(() => process.exit(0));
