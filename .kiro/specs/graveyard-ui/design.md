# graveyard-ui: design

## Components
| File | Role |
| --- | --- |
| `components/Scanner.tsx` | State machine: form → POST `/api/scan` → NDJSON reader → results, filters, exports, keyboard map |
| `components/graveyard/GateScene.tsx` | Original SVG night scene: lychgate, lantern, fence, moon, stars, fireflies, fog layers. `open` swings the doors while scanning |
| `components/graveyard/Plot.tsx` | Arrival-order marker grid (R2.5) |
| `components/graveyard/GraveCard.tsx` | One grave: stone, cause, URL, meta, evidence `<details>`, snapshot + Resurrect switch |
| `components/graveyard/HealthGauge.tsx` | `role="meter"` ring gauge |
| `components/graveyard/icons.tsx` | Seven line-art spirits on a 32px grid, `currentColor` |
| `components/graveyard/spirits.ts` | Labels, blurbs, order, default-resurrect set |

## Data flow
1. Submit builds `{kind, ...}` and POSTs it. The response is NDJSON (`status`, `meta`, `result`, `done`, `error`).
2. `result` events are buffered and flushed once per animation frame, so a burst of 300 results costs a handful of renders.
3. `meta.docs` keeps the original Markdown on the client. Patching (`lib/patch`) runs in the browser, so no document is stored server-side.
4. The health score is computed the same way as the server's `healthScore()` until `done` arrives with the authoritative summary.

## Fog = health
`--fog = max(0.12, (100 − health) / 100)` is set on `:root`. The page fog field and the three scene fog layers read it in `opacity: calc(...)`, with a 1.6 s transition, so the night visibly clears or thickens as results stream in.

## Motion budget
Transforms and opacity only (no animated filters or layout). Entrance: `rise` 0.5–0.9 s. Ambient: lantern sway 6 s, fog drift 24–52 s, stars twinkle, fireflies, one bat on an `offset-path`. Everything is disabled by `prefers-reduced-motion` and by Daylight mode.

## Theming
Tokens live in `app/globals.css` under `[data-theme="night"]` and `[data-theme="daylight"]`. The scene uses the same tokens (`--sky-*`, `--wood*`, `--lantern`), so Daylight is a real dawn version of the illustration, not a filter.

## Responsive
Desktop: the gate sits right of centre (x≈800 of 1200) and the headline owns the left. Below 640 px the SVG is widened and offset by 400 px so the gate is centred under the headline, and the form overlaps the scene less.
