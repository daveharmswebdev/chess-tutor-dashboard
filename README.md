# chess-tutor-dashboard

A daily, honest status page for the chess-tutor build (proof of concept). See `dashboard-plan.md`.

**Rule:** every fact on the page comes from an API or a committed file, never from AI. Each item links to its source.

## How it works

```
GitHub Action (schedule / manual / chess-tutor merge)
  -> scripts/snapshot.ts  fetches GitHub PRs, Project 5, CI runs, Render deploys, /api/health
  -> snapshots/YYYY-MM-DD.json  committed (permanent history)
  -> Render redeploys -> src/server.ts (Fastify) renders the page behind a shared password
```

| Path | What |
| --- | --- |
| `scripts/snapshot.ts` | Builds today's snapshot |
| `src/fetch/` | GitHub, Render and health fetchers |
| `src/page.ts` | HTML template |
| `src/server.ts` | Fastify server with basic auth |
| `glossary.json` | Hand-written client wording per requirement ID |
| `snapshots/` | One JSON file per day |

## Run locally

```sh
pnpm install
pnpm snapshot                 # uses your `gh` login; set RENDER_API_KEY / APP_URL for status
pnpm dev                      # http://localhost:3100 (no password unless DASHBOARD_PASSWORD is set)
```

## Configuration

| Where | Name | Purpose |
| --- | --- | --- |
| Actions secret | `DASHBOARD_GH_TOKEN` | Read chess-tutor PRs, issues, Actions, and Project 5 |
| Actions secret | `RENDER_API_KEY` | Live deploy status (full-access key: CI only, never on Render) |
| Actions variable | `APP_URL` | chess-tutor's public URL, for the health check |
| Render env | `DASHBOARD_PASSWORD` | The shared page password |

Optional: `TARGET_REPO` (default `daveharmswebdev/chess-tutor`), `PROJECT_NUMBER` (5), `DASHBOARD_TZ` (`America/Chicago`), `RENDER_SERVICE_NAME` (`chess-tutor`).
