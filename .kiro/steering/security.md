# Security

- SSRF: DNS resolve before connect; block RFC1918, loopback, link-local, cloud metadata; re-validate on every redirect hop
- No secrets in the client; no storing user credentials. Exception (Fix it, 26 Nov 2026): `/api/fix` accepts the user's own GitHub token for that one request only; it is never stored, logged, echoed or put in an error, and is only sent to the fixed host https://api.github.com
- Rate limit per IP; hard caps on links and concurrency
- Public GitHub API only; no tokens in the default path (scans never take a token; only the opt-in Fix it request does)
- Report retention 30 days; no accounts
- Pre-commit secret scan hook
- Treat Zombie (re-registered / parked domains) as a security risk in the UI copy
