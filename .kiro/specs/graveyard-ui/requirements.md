# graveyard-ui: requirements (EARS)

Scope: the single-page scanner UI in `app/page.tsx`, `components/Scanner.tsx` and `components/graveyard/*`.
Design rules live in `.kiro/steering/haunted-design.md`.

## R1 The gate (input)
- R1.1 The system shall offer three input modes as an ARIA tablist: GitHub repo, Website, Paste Markdown. Left/Right arrow keys shall move between tabs.
- R1.2 WHERE the mode is Website or Paste Markdown, the system shall offer an optional "cited on" date that enables drift and takeover checks.
- R1.3 The system shall offer one-click presets (two public repos and a sample reading list) that fill the form without starting a scan.
- R1.4 WHEN the user presses "/" outside a text field, the system shall focus the active input.

## R2 The graveyard rises (streaming)
- R2.1 WHEN a scan starts, the gate illustration shall open and the status line shall describe progress in plain language.
- R2.2 WHILE a scan is running, the system shall add each result as it arrives (batched per animation frame) and show checked/total progress.
- R2.3 WHILE a scan is running, the system shall show live counts per class, and the health score (0–100) as a meter.
- R2.4 The fog density of the page and the scene shall follow the health score: lower health, thicker fog.
- R2.5 The system shall render every checked link as a marker in a plot in arrival order; clicking a marker shall focus and open that grave. The plot is a visual index only; the list is the accessible equivalent.
- R2.6 The list shall be ordered worst first (Zombie, Tombstone, Ghost, Drifted, Restless, Sealed, Living), then by confidence.
- R2.7 WHEN the user stops a scan, the system shall abort the request and keep the results so far.

## R3 Inspect a grave
- R3.1 Each grave shall show its class, its first cause of death, the URL, cite date and source, where it was found, and confidence.
- R3.2 Each grave shall expand to evidence: all reasons, HTTP status, redirects (each hop), title, drift similarity and RDAP registration date when known.
- R3.3 WHEN the user presses j/k, focus shall move to the next/previous grave; Enter shall toggle its evidence; Esc shall close it.
- R3.4 WHERE a Wayback snapshot exists, the grave shall show its date, whether it is the closest copy before the cite date, and a Preview link.

## R4 Resurrect and leave with the fix
- R4.1 WHERE the input has documents (repo or pasted Markdown), each resurrectable grave with a snapshot shall have a Resurrect switch. Tombstones, Ghosts and Zombies shall be switched on by default.
- R4.2 WHEN the scan is done, the system shall offer: patched Markdown per changed file, one unified diff, a ready PR description (copied to the clipboard, or downloaded if the clipboard is unavailable), and a Markdown report.
- R4.3 The patch shall change only the selected URLs (property-tested in `tests/markdown.test.ts`).

## R5 Accessibility and motion
- R5.1 The system shall provide Daylight mode: a light, high-contrast palette with every animation off. It shall persist, and default on for `prefers-contrast: more`.
- R5.2 WHILE `prefers-reduced-motion: reduce` is set, the system shall disable animation and smooth scrolling.
- R5.3 Text shall meet 4.5:1 contrast in both themes. Every class shall be conveyed by text, never by colour or icon alone.
- R5.4 Every interactive control shall be reachable by keyboard and have a visible focus ring; a skip link shall jump to the scanner.
- R5.5 The illustration and icons shall be original SVG, with no third-party artwork.

## R6 Share the graveyard
- R6.1 WHEN a scan is done, the system shall offer "Share report + badge", which saves the per-link verdicts (no documents, no timings, no IP addresses) to Neon Postgres and returns a public read-only page `/r/<id>`.
- R6.2 The server shall recompute the health score from the submitted verdicts, so a client cannot claim a healthier graveyard than it sent; it shall validate every field and reject reports over 300 links or 600 KB.
- R6.3 Report ids shall be 12 unguessable characters (60 bits); invalid ids shall 404 without touching the database.
- R6.4 Reports shall be deleted 30 days after creation; an expired report shall show a "passed on" page and its badge shall turn grey ("report expired") instead of breaking the README.
- R6.5 The system shall offer a README badge (`/api/badge/<id>`, SVG, XML-escaped) and copy its Markdown snippet to the clipboard.

## R7 The séance (resurrect preview)
- R7.1 WHERE a grave has a snapshot, the system shall offer "Hold a séance" (and the `s` key on a focused grave) to open a modal comparing Then (the Wayback capture, framed) with Now (status, landing URL, title today, drift, RDAP date, confidence).
- R7.2 The framed capture shall load in Wayback's toolbar-less `if_` mode inside a sandboxed iframe with no scripts, forms, popups or top navigation (`sandbox="allow-same-origin"` only, so archived stylesheets with SRI still load); CSP shall allow frames from `https://web.archive.org` only.
- R7.3 WHERE the input has documents, the séance shall show the exact lines the patch changes (before struck through, after highlighted).
- R7.4 The séance shall let the user Resurrect or Leave the link; the choice shall sync with the grave's switch, and focus shall return to the grave on close.
- R7.5 The séance shall be a native modal dialog (focus trapped, Esc closes, backdrop click closes) and its motion (fog curtains parting, panes sliding in, a lantern rising on Resurrect) shall be off under reduced motion and Daylight.

## R8 Sound
- R8.1 The system shall offer a sound toggle, off by default and persisted.
- R8.2 WHILE sound is on, the system shall voice the gate opening, the worst class in each batch of results (throttled to one voice per 140 ms), the scan finishing, and each resurrection.
- R8.3 All sound shall be synthesized at runtime with Web Audio (no samples, nothing licensed).
