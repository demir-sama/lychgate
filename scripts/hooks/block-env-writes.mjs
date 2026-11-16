#!/usr/bin/env node
// Kiro PreToolUse hook: block agent writes to .env* files (except .env.example).
// Kiro passes the tool call as JSON on stdin; exit code 2 blocks the call.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }
  const args = input.tool_input ?? input.toolArgs ?? {};
  const paths = [args.path, args.file_path, args.filePath, args.target, ...(Array.isArray(args.paths) ? args.paths : [])].filter((p) => typeof p === "string");
  const bad = paths.find((p) => /(^|\/)\.env(\.|$)/.test(p) && !/\.env\.example$/.test(p));
  if (bad) {
    process.stderr.write(`Blocked: ${bad} may hold secrets. Put placeholders in .env.example and set real values in Vercel.\n`);
    process.exit(2);
  }
  process.exit(0);
});
