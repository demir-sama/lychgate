# Security

- SSRF: DNS resolve before connect; block RFC1918, loopback, link-local, cloud metadata; re-validate on every redirect hop
- No secrets in the client; no storing user credentials
- Rate limit per IP; hard caps on links and concurrency
- Public GitHub API only; no tokens in the default path
- Report retention 30 days; no accounts
- Pre-commit secret scan hook
- Treat Zombie (re-registered / parked domains) as a security risk in the UI copy
