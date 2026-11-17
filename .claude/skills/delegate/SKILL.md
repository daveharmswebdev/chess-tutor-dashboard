---
name: delegate
description: Hand one scoped task to one of the dashboard's spokes (data-agent, page-agent, reviewer, researcher): decide whether to delegate, decompose against the P/D/O requirement IDs, check the premises, write a schema-checked brief, render it, launch it in a worktree, then verify the hook-checked return. Use for every delegation in this repo.
argument-hint: "[agent] [task]"
---

# Delegate a round

Arguments: `$ARGUMENTS`

## 1. Should this be delegated?

Do it inline for a typo, a one-line fix, docs, the glossary wording, or config: those are
coordinator territory anyway. Delegate implementation work inside an owned area
(`.claude/ownership.json`):

| Work | Spoke |
|---|---|
| A new or changed source, a fetcher fix, what the snapshot holds | data-agent |
| A panel, layout, styling, the server or auth | page-agent |
| An API or platform question that would otherwise be guessed | researcher, **before** the brief |
| Any change beyond trivial, after verification | reviewer |

Pick **only the spokes the task needs**. A new panel is usually: coordinator extends
`src/types.ts` → data-agent fills it → page-agent shows it → reviewer. The data and page
rounds can run in parallel once the contract is committed, since their scopes never overlap.

## 2. Decompose deliberately

List every case the requirement IDs name and make sure each lands in some brief's objective
or rubric. For any data work that always includes P-2's cases: **missing key, empty
response, failing response, timeout**. For any page work: **null and degraded snapshot
values, an older snapshot without the new field (O-4), 390 px**. A missing category traces
back to this step, not to a spoke.

## 2b. Claim the issue

Every round belongs to a GitHub issue (file one first if needed: the user reads issues
and the board, not code). The board is project 6.

```bash
node --no-warnings .claude/scripts/board.ts <n> --status "In Progress"
gh issue edit <n> --add-label in-progress
gh issue comment <n> --body "Started: <agent> is building this (brief <brief_id>)."
```

## 3. Prepare the base

- **Contract first.** If the task changes what a snapshot holds, extend `src/types.ts`
  yourself (new fields optional, so older snapshots still type-check and render; bump
  `schemaVersion` for a breaking change), update `test/fixtures/snapshot.json` if the page
  round needs the new field in its fixture, and commit. Worktrees branch from HEAD
  (`worktree.baseRef: "head"`); uncommitted work isn't carried over.
- `git rev-parse --short HEAD` → `base_sha`.
- **Check every premise** the brief states (an API's response shape, a field's presence,
  "tests are green at base") by running it, and paste the real output into `contract`.
  For an external API, a scrubbed recorded response is the best contract: commit it under
  `test/data/fixtures/` first if data-agent will need it.

## 4. Write the brief

Start it with the scaffold, which picks the next sequence number, sets `base_sha` to HEAD
and fills the mechanical fields:

```bash
node --no-warnings .claude/scripts/new-brief.ts <agent> <slug> --issue <n> --scratch <scratchpad> \
  [--round <k> --base <spoke's last commit>] [--contract-file src/types.ts]...
```

Then edit the TODO fields (validation refuses a brief that still has one) against
`.claude/schemas/brief.schema.json`. `requirements` takes P/D/O IDs: always include the
principles the round must keep (usually P-1, P-2, P-4, P-6). `contract` must be
**self-contained**, because the spoke can't see this conversation. Put whole files in
`contract_files` (render-brief inlines them from git at `base_sha`); `contract` holds the
excerpts, decisions and measured facts. The rendered brief already ends with a return
template generated from the schema, so don't restate the return format.

## 5. Render and launch

```bash
node --no-warnings .claude/hooks/delegation.ts render-brief .claude/orchestration/briefs/<id>.json --out <scratch>/<id>.prompt.md
```

Pass the rendered text as the Agent prompt, with `subagent_type` set to the spoke and
`isolation: "worktree"` for implementation spokes (and for a reviewer that runs commands).
The `pre-agent` hook denies a prompt that wasn't rendered from a valid, unchanged brief.

## 6. When the spoke returns

The hooks have already checked the shape, and `post-agent` tells you the verdict.

- **Not `return_valid`** (`return_invalid`, `contract_failed` or `unchecked`): the round
  failed as `malformed-return`. Use nothing from it; re-plan.
- **`failure`**: read `failure_type`, `retryable` and `alternatives`. Fix the brief or
  the input, then send the next round with a fresh brief and `round + 1`.
- **`success`**: verify, don't trust:
  1. `git diff --name-only <base_sha>..<head_sha>` must equal `files_changed`, and sit
     inside the brief's `scope`.
  2. Re-run the gate (`pnpm test && pnpm typecheck`) on that commit yourself.
  3. **Look at the output, not just the tests.** Data rounds: run `pnpm snapshot` on the
     branch and read the JSON (then discard it: `git checkout -- snapshots/`). Page rounds:
     run the server against the fixture and look at it at desktop and 390 px.
  4. `git diff <base>..<head> | grep -iE "token|secret|password|authorization|api[_-]?key"`
     and read every hit: the repo is public (P-6).
  5. Read `brief_defects` and `contract_gaps`: these are *your* errors to fix.
- Only after verification passes, run the reviewer if the change warrants it (anything
  beyond a trivial change does). Blocking findings mean another round, not a merge. Ask for
  severities as `blocking` / `major` / `minor`. Non-blocking findings go to `/triage`.
  **Launch the reviewer from the branch under review**: check out the spoke's commit in the
  main checkout first, so the reviewer's worktree starts at the reviewed head, and set the
  review brief's `base_sha` to that head. The range to review goes in the objective
  (`git diff <base>..<head>`).
- Round 2 on the same branch: render a fresh brief (`round + 1`, `base_sha` = the spoke's
  last commit) and send it with SendMessage to the same spoke, which keeps its worktree.
- Then `/ship <n>`.

## 7. Record

`.claude/orchestration/log.jsonl` is written by the hooks. Append the coordinator's own
decision for the round, with the cost from the spoke's completion notification (`<usage>`:
`subagent_tokens`, `duration_ms`), which the hooks can't see for background spokes:

```bash
node -e 'require("fs").appendFileSync(".claude/orchestration/log.jsonl", JSON.stringify({ts:new Date().toISOString(),event:"coordinator_verdict",brief_id:"<id>",agent:"<spoke>",verdict:"accepted|rejected|re-delegated",reason:"<one line>",tokens:<subagent_tokens>,duration_ms:<duration_ms>})+"\n")'
```

Log a reviewer's cost the same way under its own brief_id, with `verdict:"review"`.
