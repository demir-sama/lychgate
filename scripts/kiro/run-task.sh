#!/usr/bin/env bash
# Run one spec task headless in Kiro CLI with the repo's custom agent.
#   scripts/kiro/run-task.sh mcp-server 1
# Needs a signed-in Kiro CLI (`kiro-cli login --use-device-flow`); credits come from that account.
set -euo pipefail
# Transcripts land in docs/kiro-runs/ and are committed (after pnpm secret-scan) as evidence of Kiro use.
spec="${1:?spec name, e.g. mcp-server}"
task="${2:?task number}"
cd "$(dirname "$0")/../.."
test -f ".kiro/specs/$spec/tasks.md" || { echo "no such spec: $spec" >&2; exit 1; }
kiro-cli whoami >/dev/null 2>&1 || { echo "Kiro CLI is not signed in. Run: kiro-cli login --use-device-flow" >&2; exit 1; }
mkdir -p docs/kiro-runs
log="docs/kiro-runs/$(date +%Y%m%d-%H%M%S)-$spec-$task.log"
kiro-cli chat --agent gravedigger --no-interactive --trust-workspace --trust-tools=fs_read,fs_write,shell \
  "You are running inside Kiro CLI as the gravedigger custom agent. Implement only task $task of .kiro/specs/$spec/tasks.md. Read requirements.md and design.md for that spec first. Test first; finish only when pnpm test and pnpm typecheck pass. Do not edit .kiro/agents or commit. Then tick the task and add one dated line to KIRO_USAGE.md saying it was built in Kiro CLI by the gravedigger agent via scripts/kiro/run-task.sh $spec $task." \
  2>&1 | tee "$log"
