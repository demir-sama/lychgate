# Kiro CLI postToolUse hook trace, 25 Nov 2026
Captured by temporarily teeing the gravedigger agent's postToolUse hook while Kiro CLI wrote a probe Markdown file (the probe was deleted afterwards).

## Event Kiro sent (truncated)
```json
{"hook_event_name":"postToolUse","cwd":"/workspace/hackathons/kiroween/lychgate","session_id":"c819aa9c-ea38-426e-ab56-70bac8fb4d57","tool_name":"write","tool_tags":["write","@builtin"],"tool_input":{"command":"create","path":"docs/hook-probe.md","content":"# Hook probe\n\n- [vine](https://vine.co/u/12345)\n","__tool_use_purpose
```

## Hook output
```
lychgate: 1 dead link in docs/hook-probe.md
- Tombstone: https://vine.co/u/12345 (docs/hook-probe.md:3)
  snapshot: none found
Offer the patch to the person; do not edit the file without asking.
```
