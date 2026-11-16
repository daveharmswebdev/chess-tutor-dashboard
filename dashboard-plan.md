# chess-tutor-dashboard: client transparency

Nov 16, 2026 · @Dave

## Purpose

This is a proof of concept to show the COO. It demonstrates a dashboard that gives a client a daily, honest view of their build, using chess-tutor as the example project, so a lack of information is never something a client worries about. Communication is cheap and losing a client is expensive. The aim is to ease the client's anxiety, not to show a perfect app.

Because it is a POC, cost and hardening stay minimal: one public repo, one small Render service, free tiers wherever possible. Anything that only matters for a real client engagement is noted rather than built.

Guiding rule: **every fact on the page comes from an API, a committed file or a script, never from AI synthesis.** Every claim links to the PR, issue, deploy or run behind it. Hand-written words (a glossary, a one-line client note per PR) translate the facts into plain language.

Principles:

- **Same rhythm every day**, including slow days ("mostly testing today; nothing visible changed").
- **Bad news early, in plain words**, with what is being done about it.
- **Clear split** between "needs a decision from you" and "we are handling it".

## Scope

The POC has five panels, ranked by value to the client.

| Panel | What the client sees | Source of truth |
| --- | --- | --- |
| Status strip | Link to the app, up or down, version live, last updated | Render deploys (live commit in phase 1), external uptime monitor, `/api/health` |
| Daily digest | What shipped today in plain words, what is next, decisions needed | Merged PRs (client note), issues, Project board |
| Progress vs plan | Features done out of planned, by requirement | Glossary file + closed issues per requirement ID |
| End-of-day demo | A 60-90 s video of the live app, with the tutor catching a planned mistake | Playwright demo run against production |
| Usage and health | Games played, tutor replies, latency, errors, Claude spend (demo runs excluded) | `/ops/daily-stats` rollup, usage ledger |

Out of scope:

- Audio read-aloud digest (dropped for the POC; could be added later from the templated digest text)
- Raw logs, stack traces or any user content on the page
- AI-written status text
- Several clients or per-user logins (one client, one shared password)
- Editing anything in chess-tutor from the dashboard

## Data sources and integrations

Six integrations feed the dashboard. Only one, `/ops/daily-stats`, is a new chess-tutor feature; the rest read systems that already exist.

| Source | API | Data | Credential |
| --- | --- | --- | --- |
| GitHub PRs and commits | REST | Merged PRs, client note, linked issue, diff size | Fine-grained token, read-only, chess-tutor + dashboard repos |
| GitHub issues and Project 5 | GraphQL (Projects v2) | Status, priority, blocked-by, counts | Same token, plus Projects read |
| GitHub Actions | REST | CI pass/fail per merge, test count | Same token |
| Render deploys | Render API | Live commit, deploy time, success or failure | Render API key (not read-only scoped; CI secret only) |
| Uptime | External monitor (for example UptimeRobot or Better Stack, free tier) | Uptime %, response time | Monitor read-only API key |
| App stats | `GET /ops/daily-stats` on chess-tutor | Games, tutor replies, p50/p95 latency, errors by category, spend | Shared secret |

Two hand-written files turn facts into client language without AI:

1. **Glossary** (`glossary.json` in the dashboard repo): requirement ID to client wording, for example `FR-25 -> "Tutor notes saved with each move"`.
2. **PR client note**: a required one-sentence section in chess-tutor's PR template, enforced by a CI check, printed word for word.

The app stats endpoint returns counts only, never log lines or user content. It tags and excludes the dashboard's own demo sessions, so the daily demo doesn't inflate usage. Spend can be cross-checked against Anthropic's Admin API usage and cost report, which needs an admin key.

## Architecture and deployment

The dashboard is its own repo, deployed as a separate service in the existing Render workspace. One GitHub Action does all the work; Render only serves the page.

&#91;embedded content: dashboard pipeline · 3 sources, 1 Action, 1 page\]

Each day's facts are a committed JSON file, so the history is permanent and auditable. Uptime is checked by an external monitor outside this pipeline (and outside Render), because scheduled Actions can run late and a Render-side check can't see a Render outage.

- **Repo:** `chess-tutor-dashboard`, public, with the fetch scripts, `glossary.json`, page template, `render.yaml` and `snapshots/`.
- **Triggers:** chess-tutor sends a `repository_dispatch` ping on each merge to main; a daily schedule covers days with no merges.
- **Hosting:** a small Render web service serving the built page behind HTTP basic auth (Starter instance), with one shared password.
- **Secrets:** GitHub token, Render API key, uptime monitor key and the stats shared secret live in Actions secrets only. The Render service holds only the basic-auth password.

## End-of-day demo

Each day a Playwright script plays a guided game on the live app and records it. The tutor is always shown catching a planned mistake. The script lives in chess-tutor (`apps/web/demo/`), so a renamed test ID breaks it in the same PR.

Scenario, about 60-90 seconds:

1. **Opening.** A few London (or King's Indian) moves that stay legal whatever the bot replies, the trick `play.spec.ts` already uses.
2. **Planned mistake.** At a set move the script asks Stockfish (the engine package, WASM) for a move that loses about 2 pawns or more, and plays it.
3. **Tutor reacts.** The tutor's question appears; the script presses Hint, then Show me, pausing so the viewer can read.
4. **Close.** An end caption with a timing the script measured, for example "Tutor caught the mistake in 3.2 s".

Captions are fixed text in the script. The tutor's own words vary, which is fine: it is the real product.

Run order in the dashboard Action:

1. Poll `/api/health` until it reports the commit just merged.
2. Check out chess-tutor at that commit and run its demo against production with video on.
3. Convert `.webm` to `.mp4` with ffmpeg.
4. Upload the video to storage (not into git; see the parking lot) and record its link in the snapshot.
5. On failure, the dashboard shows "Today's demo failed" and the step where it stopped. The demo doubles as a production smoke test.

Cost: one or two tutor calls per run, cents a day. Scenarios rotate (London as White, King's Indian as Black, different mistake types).

## Dependencies on chess-tutor

Five changes in chess-tutor, filed as issues there and built through its usual delegation flow. The web app already has `data-testid` attributes, clickable `data-square` squares and Playwright e2e specs, so none of these is a test-ID retrofit.

| Change | Where | Unblocks | Size |
| --- | --- | --- | --- |
| Commit SHA in `/api/health` (likely from Render's `RENDER_GIT_COMMIT`) | `apps/server` | Status strip, demo waits for live deploy | Small |
| Guided demo spec with video, captions and a Stockfish-picked mistake | `apps/web/demo/` | End-of-day demo | Medium |
| `GET /ops/daily-stats` behind a shared secret, counts only, demo sessions excluded | `apps/server` | Usage and health panel | Medium |
| Client note section in the PR template + CI check | `.github/` | Daily digest | Small |
| Demo scenario rotation | `apps/web/demo/` | Fresher demos | Small, later |

The health and stats responses are contracts between the two repos; version them like the other contracts.

## Phased plan

Four phases, about 5-7 working days in total. Phase 1 alone gives the client a useful page; each later phase adds a panel.

&#91;embedded content: phased plan · 4 phases, about 5-7 working days\]

Phase 2 is chess-tutor work and can run alongside phase 1. Phase 3 needs the health SHA from phase 2. Efforts are rough estimates, not commitments.

## Decisions, parking lot and risks

Decisions (Nov 16, 2026):

- [x] Access: Render web service with HTTP basic auth, one shared password.
- [x] Repo: `chess-tutor-dashboard`, public (it's a POC).
- [x] Uptime: an external monitor service, not a Render cron job.
- [x] Audio: dropped for the POC.

Parking lot:

- [ ] Video storage. Because the repo is public, GitHub Release assets would play straight from the page with no proxy, so they're the simplest option for the POC. For a real client (private repo), use object storage such as Cloudflare R2, streamed through the basic-auth service.

Risks:

- **A public repo exposes what basic auth hides.** Committed snapshots (spend, error counts, client notes) and the demo videos can be read without the password. That's acceptable for a POC on chess-tutor. A real client engagement needs a private repo.
- **PR client notes start AI-drafted** (Claude writes chess-tutor's PRs). Mitigation: written once at merge time, approved by merging, never regenerated.
- **Scheduled GitHub Actions can run late or be skipped.** Acceptable for the digest, not for uptime, so uptime runs elsewhere.
- **Render API key has full account access.** It lives only in CI secrets, never in the page or the repo.
- **Recording an old deploy.** The demo waits for the health endpoint's commit to match the merge.
- **Selectors drift.** Mitigated by keeping the demo spec in chess-tutor next to the e2e tests.
- **Spend creep.** Cap demo runs per day; bulk self-play testing runs with the tutor off.
