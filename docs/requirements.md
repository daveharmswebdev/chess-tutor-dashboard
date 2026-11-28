# Chess Tutor Dashboard: requirements

Derived from `dashboard-plan.md`. IDs are cited in briefs, commits, PRs and reviews. **P** = principles that every change must keep, **D** = what the client sees, **O** = how it runs.

## Principles

| ID | Requirement |
| --- | --- |
| P-1 | **Facts only.** Every fact on the page comes from an API, a committed file or a script, never from AI synthesis. Hand-written words (the glossary, PR client notes) are printed word for word, never generated or rewritten. |
| P-2 | **Degrade honestly.** A source that is missing, slow or failing shows a plain-words reason ("Render could not be reached"). Never stale data presented as current, never an invented value, never a crash of the whole snapshot or page. |
| P-3 | **Clear split** between "needs a decision from you" and "we're handling it". |
| P-4 | **Every claim links to its source:** the PR, issue, commit, run or deploy behind it. |
| P-5 | **Same rhythm every day,** slow days included. Committed snapshots are history: never rewritten or deleted, except the Action overwriting the current day. |
| P-6 | **Secrets stay in CI.** GitHub token, Render API key and monitor keys live only in Actions secrets; the Render service holds only the page password. Nothing secret in the page, the repo or a snapshot (the repo is public). Tests make no network calls. |
| P-7 | **Bad news early, in plain words,** with what is being done about it. Down, failing or blocked states are shown prominently, not softened. |

## What the client sees

| ID | Requirement | Phase |
| --- | --- | --- |
| D-1 | **Status strip:** link to the app, up or down, version live (commit and deploy time), automated tests, last updated. | 1 |
| D-2 | **Daily digest:** what shipped in the last 24 hours (client note, or the PR title clearly marked as such), earlier this week, a slow-day message when nothing shipped. | 1 |
| D-3 | **Progress vs plan:** planned features (glossary) with shipped work, in progress, not started, by group, each linked to its PRs and issues. | 1 |
| D-4 | **Work split:** "needs a decision from you" from the board's Needs you column; "we're handling it" from In Progress, In Review and the top of Todo. | 1 |
| D-5 | **History:** any earlier day's snapshot is viewable, clearly marked as not today. | 1 |
| D-6 | **End-of-day demo:** a 60–90 s video of the live app, the tutor catching a planned mistake; on failure, "Today's demo failed" and the step where it stopped. | 3 |
| D-7 | **Usage and health:** games, tutor replies, p50/p95 latency, errors by category, Claude spend, from `/ops/daily-stats` (demo runs excluded). | 4 |
| D-8 | **What the app did:** the day's notable events from the app's `/ops/events` (FR-31), in time order, each in the owner's wording from the mirrored glossary's `events` section, with numbers filled in by code; demo events excluded; never a raw code (#20). | 4 |

## How it runs

| ID | Requirement |
| --- | --- |
| O-1 | **Snapshot pipeline:** one GitHub Action builds `snapshots/YYYY-MM-DD.json` on a schedule, on demand, and on chess-tutor's `repository_dispatch` merge ping, then commits it. |
| O-2 | **Hosting:** a Render web service serves the newest (or `?date=`) snapshot behind HTTP basic auth; `/healthz` is open for Render. |
| O-3 | **Uptime:** checked by an external monitor, outside the Action and outside Render. |
| O-4 | **Snapshot contract:** `src/types.ts` is the contract between the fetchers and the page. Changing it bumps `schemaVersion`, and the page still renders every committed older snapshot. |
| O-5 | **Design:** the FortyAU design system (`DESIGN.md`, `public/tokens.css`). Text people read meets WCAG AA; the page works at 390 px with no horizontal scroll. |
