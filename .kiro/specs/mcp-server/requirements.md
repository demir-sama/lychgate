# mcp-server — requirements (EARS draft)

Status: day-1 scaffold from /workspace/hackathons/kiroween/spec.md. Expand in Kiro once credits land.

## Ubiquitous
The system shall classify and present link health without requiring user accounts.

## Event-driven
WHEN a user submits a target (URL, public GitHub repo, or Markdown list), the system shall stream classification results for up to 300 links.

## State-driven
WHILE a scan is running, the system shall expose living, tombstone, ghost, drifted, and zombie counts.

## Unwanted
IF a fetch target resolves to a private, loopback, link-local, or metadata address, THEN the system shall refuse the request and record an SSRF block.

## Optional
WHERE a Wayback snapshot exists at or before the citation date, the system shall offer it as the default resurrection candidate.
