# scanner-classifier: requirements (EARS)

Scope: everything between "user submits a target" and "each link has a class, evidence and a snapshot".
UI lives in `graveyard-ui`; patching in `resurrection-engine`.

## R1 Inputs
- R1.1 WHEN a user submits a public GitHub repo (`owner/repo`, a github.com URL, or a `/tree|blob/<ref>/<path>` URL), the system shall read up to 20 Markdown files (README first, then `docs/`, shallow before deep, vendored folders skipped).
- R1.2 WHEN a user submits a website URL, the system shall extract the links on that page; WHERE the user opts in or the URL is an `.xml` sitemap, the system shall also read links from up to 12 sitemap pages.
- R1.3 WHEN a user pastes Markdown or a plain list, the system shall extract inline, image, reference-definition, autolink, GFM literal and HTML `href/src` links, and shall ignore code blocks and inline code.
- R1.4 The system shall de-duplicate links by canonical URL and check at most 300 unique links per scan, warning when the cap applies.

## R2 Cite dates
- R2.1 WHEN scanning a GitHub repo, the system shall date each link by the commit that introduced it, using the file's commit list and raw file contents (no auth token required).
- R2.2 WHILE fewer than 3 GitHub API calls remain in the rate-limit window, the system shall skip optional history calls and tell the user cite dates are missing.
- R2.3 WHERE the user enters a "cited on" date for pasted or website input, the system shall use it as the cite date.

## R3 Fetch layer
- R3.1 The system shall try HEAD first and fall back to GET when HEAD is refused or errors; for HTML it shall GET a body capped at 512 KB for analysis.
- R3.2 The system shall time out each request after 8 seconds, follow at most 5 redirects manually, and record every hop.
- R3.3 The system shall send a polite User-Agent that names the project and links to the repo.
- R3.4 The system shall run at most 8 concurrent requests per host (24 overall per scan).
- R3.5 WHEN a host answers 429 or 503, the system shall pause new requests to that host (Retry-After up to 8 s, else 1.5 s doubling, plus jitter) and retry the link at most twice before reporting it Restless.

## R4 SSRF guard (security-critical)
- R4.1 IF a URL is not http/https, carries credentials, or uses a port other than 80/443/8080/8443, THEN the system shall refuse it.
- R4.2 IF a host is `localhost`, single-label, or ends in an internal suffix (`.local`, `.internal`, `.localhost`, `.lan`, `.home.arpa`, `.corp`, `.onion`), THEN the system shall refuse it.
- R4.3 IF any DNS answer for a host is not global unicast (private, loopback, link-local, CGNAT, multicast, reserved, documentation, benchmarking, unique-local, NAT64, 6to4, Teredo, IPv4-mapped private, cloud metadata such as 169.254.169.254, 192.0.0.192, fd00:ec2::254), THEN the system shall refuse the request.
- R4.4 The system shall repeat R4.1–R4.3 for every redirect hop before connecting to it.
- R4.5 The system shall validate the resolved address again at socket-connect time, so a DNS answer that changes between check and connect (rebinding) is refused.
- R4.6 WHEN a link is refused, the system shall classify it as **Sealed** and shall not contact the archive for it.
- R4.7 The scan API shall rate-limit each client IP (6 scans per 10 minutes per instance) and bound each scan to 270 seconds.

## R5 Classification
- R5.1 IF the response is 404 or 410, or the domain does not resolve (not a temporary failure), THEN the link shall be a **Tombstone**; IF RDAP also says the domain is unregistered, THEN the evidence shall warn that anyone could buy it.
- R5.2 IF a 2xx page looks like a made-up sibling URL on the same site (cosine ≥ 0.9 and length ratio ≥ 0.8), says it is missing in its title or opening text, or a deep link redirects to the home page, THEN the link shall be a **Ghost**.
- R5.3 WHERE a cite date and a 200 snapshot at or before it exist, and the link is a deep link, IF the live text is < 35% similar to that snapshot, THEN the link shall be **Drifted**.
- R5.4 IF the page matches a parked or for-sale signature or lands on a parking host, OR RDAP shows the domain was registered more than a day after the cite date, THEN the link shall be a **Zombie** (security risk).
- R5.5 IF the server returns 401/403/429/5xx, times out, fails TLS, or DNS fails with anything other than "no such name" (e.g. EBUSY, SERVFAIL, EAI_AGAIN, retried twice first), THEN the link shall be **Restless** (unconfirmed), never dead.
- R5.8 IF a made-up sibling URL returns the same page AND the live page has under 400 characters of visible text (a JavaScript app shell or stub), THEN the link shall be Restless rather than Ghost.
- R5.9 WHEN a 200 page under 8 KB is only a `<meta http-equiv="refresh">` stub, the system shall follow it once, through the SSRF guard, and analyse the target.
- R5.10 IF the link already points at an archived copy (web.archive.org/web/…, archive.today and mirrors, WebCite, perma.cc) and answers 2xx, THEN the link shall be **Living**, and parked, soft-404 and drift checks shall be skipped (archived pages are frozen; an old "for sale" banner says nothing about today).
- R5.6 The classifier shall never label a 2xx whose content is ≥ 80% similar to the cited snapshot as Tombstone or Ghost.
- R5.7 Every verdict shall carry a confidence in [0, 1] and at least one human-readable reason.

## R6 Archive
- R6.1 The system shall pick the latest 200 Wayback snapshot at or before the cite date, or, without a cite date, the latest 200 snapshot.
- R6.2 IF no snapshot exists before the cite date for a dead link, THEN the system shall offer the latest surviving snapshot and label it as such.
- R6.3 The system shall use the CDX API, fall back to the Availability API on CDX failure, and cache results per URL and cite day.

## R7 Streaming
- R7.1 WHEN a scan runs, the system shall stream NDJSON events: `status`, `meta` (source, totals, warnings, documents), one `result` per link as soon as it is classified, then `done` with counts and a health score.
- R7.2 IF links are unfinished when the time budget ends, THEN they shall be reported as Restless with that reason.
