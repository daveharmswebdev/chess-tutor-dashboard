import type { BoardItem, Progress, RequirementProgress, ShippedPr } from "../types.ts";

export interface Glossary {
  requirements: Array<{ id: string; group: string; label: string }>;
}

/**
 * A board issue for the reported repo (any state) and the requirement IDs it names.
 * `state` is the issue's GitHub state ("OPEN" / "CLOSED"), as fetchBoard returns it.
 */
type NamedIssue = Pick<BoardItem, "number" | "status"> & { requirements: string[]; state: string };

const DONE = "Done";
const CLOSED = "CLOSED";

/**
 * Rule "every-issue-done" (#4): a requirement is "shipped" only when every board issue
 * naming it has Status "Done" (and there is at least one), "in progress" when some do,
 * and "not started" when none do or no issue names it. A null status or a closed issue
 * not marked Done counts as not Done. Merged PRs naming the ID are listed as evidence
 * but no longer decide the state. A mechanical count, which the page says in plain words.
 */
export function buildProgress(glossary: Glossary, merged: ShippedPr[], issues: NamedIssue[]): Progress {
  const requirements: RequirementProgress[] = glossary.requirements.map((r) => {
    const prs = merged.filter((p) => p.requirements.includes(r.id)).map((p) => p.number);
    const naming = issues.filter((i) => i.requirements.includes(r.id));
    const doneIssues = naming.filter((i) => i.status === DONE).map((i) => i.number);
    const notDone = naming.filter((i) => i.status !== DONE);
    const openIssues = notDone.map((i) => i.number);
    // Closed on GitHub but never marked Done (#14): still counted as not Done, labelled closed.
    const closedIssues = notDone.filter((i) => i.state === CLOSED).map((i) => i.number);
    const state = !doneIssues.length ? "not-started" : openIssues.length ? "in-progress" : "shipped";
    return { ...r, state, prs, openIssues, doneIssues, closedIssues };
  });
  return {
    requirements,
    shipped: requirements.filter((r) => r.state === "shipped").length,
    inProgress: requirements.filter((r) => r.state === "in-progress").length,
    total: requirements.length,
    rule: "every-issue-done",
  };
}
