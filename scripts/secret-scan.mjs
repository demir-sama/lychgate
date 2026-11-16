#!/usr/bin/env node
// Pre-commit / pre-push secret scan. Scans every file git would commit
// (tracked + untracked-but-not-ignored). Exits 1 on any finding.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const RULES = [
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["Private key block", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ["OpenAI-style key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{32,}\b/],
  ["Stripe live key", /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@[^\s/]+/i],
  ["Vercel token", /\bvercel_[A-Za-z0-9]{20,}\b|\bVERCEL_TOKEN\s*=\s*['"]?[A-Za-z0-9]{20,}/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["ElevenLabs key", /\bsk_[a-f0-9]{48}\b/],
  ["Generic assigned secret", /\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{24,}['"]/i],
];
const ALLOW = [/test-token-not-real/];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !/^pnpm-lock\.yaml$/.test(f));

let findings = 0;
for (const f of files) {
  let st;
  try {
    st = statSync(f);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size > 2_000_000) continue;
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) {
    console.error(`✗ ${f}: .env file would be committed`);
    findings++;
    continue;
  }
  const text = readFileSync(f, "utf8");
  if (text.includes("\u0000")) continue;
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of RULES) {
      if (re.test(line) && !ALLOW.some((a) => a.test(line))) {
        console.error(`✗ ${f}:${i + 1}: possible ${name}`);
        findings++;
      }
    }
  });
}
if (findings) {
  console.error(`\nsecret-scan: ${findings} finding(s). Remove them before committing.`);
  process.exit(1);
}
console.log(`secret-scan: clean (${files.length} files)`);
