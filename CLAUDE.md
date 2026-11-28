# Chess Tutor Dashboard

A private daily status page that gives the chess-tutor client an honest view of the build, so a lack of information is never something they worry about. It's a proof of concept for the COO. Plan: `dashboard-plan.md`. Requirement IDs (P principles, D what the client sees, O how it runs): `docs/requirements.md`. Design system: `DESIGN.md`.

## Rules

- **Facts only (P-1).** Every fact on the page comes from an API, a committed file or a script, never from AI synthesis. Glossary wording and PR client notes are printed word for word. Never write, reword or "improve" client-facing text with a model.
- **Degrade honestly (P-2, P-7).** A failing source shows a plain-words reason, never stale or invented data, and bad news is never softened or hidden.
- **Every claim links to its source (P-4).**
- **The repo is public (P-6).** Secrets live only in Actions secrets (`DASHBOARD_GH_TOKEN`, `RENDER_API_KEY`) and Render env (`DASHBOARD_PASSWORD`). Never write a token, key or personal data into code, fixtures, snapshots or logs. Tests make no network calls.
- **Snapshots are history (P-5).** Never edit or delete committed files in `snapshots/`; only the Snapshot Action writes them.
- **`src/types.ts` is the contract (O-4)** between fetchers and page. New fields are optional; a breaking change bumps `schemaVersion`; every committed snapshot must still render.
- Reference requirement IDs in commits and PRs. PRs carry a `## Client note`: the same convention the dashboard reads from chess-tutor.

## Working model: hub and spoke

The main session is the coordinator. Implementation goes to spokes via `/delegate`, in worktrees, with JSON-schema briefs and returns enforced by hooks. See `docs/orchestration.md` and `.claude/ownership.json`. The coordinator owns the snapshot contract, glossary, snapshots, fixtures, `docs/`, `.claude/`, `.github/`, `render.yaml`, root config and dependencies, and verifies every spoke return (re-runs the gate, compares `git diff` with `files_changed`, looks at the output) before merging. Progress is tracked on GitHub: issues and board 6.

## Stack and commands

TypeScript, Node 22 (type stripping, so `.ts` imports carry their extension), pnpm, Fastify, Vitest. No frontend framework: the page is server-rendered HTML from template strings.

- `pnpm test`: app tests (fixture snapshots, stubbed fetch) plus the delegation hook tests
- `pnpm typecheck`: app and hooks
- `pnpm snapshot`: build today's snapshot locally (uses your `gh` login; set `RENDER_API_KEY` for deploy status). Don't commit the result; the Action does that.
- `pnpm dev`: the page on http://localhost:3100 (no password unless `DASHBOARD_PASSWORD` is set)

## Layout

- `src/fetch/`: GitHub, Render and health fetchers (data-agent)
- `scripts/snapshot.ts`: builds `snapshots/YYYY-MM-DD.json` (data-agent)
- `src/page.ts`, `src/server.ts`, `public/`: the page, the server, design tokens and styles (page-agent)
- `src/types.ts`: the snapshot contract (coordinator)
- `glossary.json`: requirement ID to client wording, a byte-for-byte mirror of chess-tutor's `docs/glossary.json` at the commit in `glossary.source.json` (#21). Never edit it here: change the wording in chess-tutor; the Snapshot Action mirrors it on each merge and CI fails on a hand edit
- `.github/workflows/snapshot.yml`: the pipeline; `ci.yml`: tests on PRs
- Live: https://chess-tutor-dashboard.onrender.com (basic auth), chess-tutor app: https://chess-tutor-hyb9.onrender.com
