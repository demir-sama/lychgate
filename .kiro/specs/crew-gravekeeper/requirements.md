# crew-gravekeeper: requirements (EARS)

Scope: a separate public repo (`demir-sama/gravekeeper`) holding a Kiro Crew app, entered for the "Best Kiro Crew App" bonus. It watches a list of public repos and re-scans their docs on a schedule with the Lychgate API.

## R1 Crew app
- R1.1 The app shall declare one agent ("Gravekeeper") and one skill ("walk-the-graveyard") in `app.json`.
- R1.2 WHEN the weekly schedule fires, the agent shall POST each watched repo to the public Lychgate `/api/scan`, wait for `done`, and save the summary.
- R1.3 WHEN a repo's health drops or a new Zombie appears since the last walk, the agent shall write a short report with the new graves, their snapshots, and a ready PR description.
- R1.4 The app shall publish a dashboard page listing each watched repo, its health trend, and a link to its latest shared Lychgate report.

## R2 Safety
- R2.1 The app shall only scan public repos named in its config, at most 10 per walk, respecting Lychgate's rate limit.
- R2.2 The app shall never open pull requests or write to the watched repos; it only reports.

Status: requirements only. Build after the main entry is complete; confirm the current Kiro Crew `app.json` format on kiro.dev first.
