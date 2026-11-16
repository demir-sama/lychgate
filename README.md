# Lychgate

**Find every dead link, see how it died, and resurrect it in one click.**

Lychgate is a haunted graveyard for broken links, built for [Kiroween 2026](https://kiroween.devpost.com) (Costume Contest). Paste a website, a public GitHub repo or a Markdown list, and every link rises as one of:

| Spirit | Meaning |
| --- | --- |
| 🕯️ Living | Healthy |
| 🪦 Tombstone | 404 / 410 / DNS dead |
| 👻 Ghost | Soft-404: returns 200 but the content is gone |
| 🌫️ Drifted | Live, but no longer says what it said when it was cited |
| 🧟 Zombie | Domain re-registered or parked since it was cited (a security risk) |

Each grave shows cause of death, evidence and the Wayback Machine snapshot closest to the date the link was added. Resurrect it, then leave with a patched Markdown file, a unified diff, a PR description and a shareable health report.

## Status

Early build. This repo currently holds the Kiro steering files and specs (`.kiro/`) that drive the build; the app lands next.

## Built with Kiro

- `.kiro/steering/` covers product, tech, structure, security, haunted design and testing
- `.kiro/specs/` holds EARS requirements for the scanner, resurrection engine, graveyard UI, MCP server and gravekeeper crew

## Licence

MIT © Demir ([demir-sama](https://github.com/demir-sama))
