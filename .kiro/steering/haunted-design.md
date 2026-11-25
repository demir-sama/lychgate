# Haunted design

Costume Contest: the spooky metaphor must enhance function.

## Tokens
- Living = quiet lantern
- Tombstone = 404/410/DNS dead
- Ghost = soft-404
- Drifted = live but meaning shifted
- Zombie = domain takeover / parked
- Fog density = overall health score

## Rules
- Original illustrations and sound only; mute toggle
- Daylight mode for a11y and reduced motion (WCAG answer); contrast ≥ 4.5:1
- Keyboard-first; screen-reader labels on every grave state
- Motion budget: prefer transforms; respect prefers-reduced-motion
- Copy tone: clear and a little haunted, never campy enough to hide the evidence

## Implementation notes (keep in sync with app/globals.css)
- Night palette: ink #ece7dc on #090b14–#171d33, lantern amber #f5b94a as the single accent. Daylight: parchment #f7f3ea, ink #1b1c22, accent #7a4a00. Every class colour is ≥ 5.9:1 on every surface in both themes.
- Type: Fraunces (display, italic for the second line of the headline), IBM Plex Sans (body), IBM Plex Mono (URLs, counts, eyebrow).
- Fog: `--fog = max(0.12, (100 − health) / 100)` drives page and scene fog opacity.
- The gate's doors open only while a scan runs; nothing moves just to move.
- Class is always written as text next to its icon; icons use `currentColor`.
