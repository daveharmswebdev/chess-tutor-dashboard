import type { BoardItem, Progress, RequirementProgress, ShippedPr } from "../types.ts";

/** A requirement the client sees: its wording, copied word for word into the snapshot (P-1). */
export interface LabelledEntry {
  id: string;
  group: string;
  label: string;
}

/** A requirement chess-tutor leaves off the client's list, with its reason (#21, D-3). Never counted. */
export interface ExcludedEntry {
  id: string;
  excluded: string;
}

/**
 * glossary.json: a mirror of chess-tutor's docs/glossary.json (#21). The old dashboard shape
 * (labelled entries only, no events) is the same minus `excluded` and `events`.
 */
export interface Glossary {
  requirements: Array<LabelledEntry | ExcludedEntry>;
  events?: Array<{ code: string; label: string }>; // not read yet (#20)
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * The labelled entries, in glossary order, with exactly id, group and label. Excluded entries are
 * dropped. A malformed glossary throws an error naming the entry (P-2), never a row with undefined text.
 */
export function labelledRequirements(glossary: Glossary): LabelledEntry[] {
  const list: unknown = (glossary as { requirements?: unknown } | null)?.requirements;
  if (!Array.isArray(list)) throw new Error("glossary.json: requirements is not a list");
  const out: LabelledEntry[] = [];
  list.forEach((entry: unknown, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (!isText(e.id)) throw new Error(`glossary.json: requirement ${i + 1} has no id`);
    if ("excluded" in e) {
      if (!isText(e.excluded)) throw new Error(`glossary.json: ${e.id} has an empty excluded reason`);
      return;
    }
    if (!isText(e.label)) throw new Error(`glossary.json: ${e.id} has no label`);
    if (!isText(e.group)) throw new Error(`glossary.json: ${e.id} has no group`);
    out.push({ id: e.id, group: e.group, label: e.label });
  });
  return out;
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
  const requirements: RequirementProgress[] = labelledRequirements(glossary).map((r) => {
    const prs = merged.filter((p) => p.requirements.includes(r.id)).map((p) => p.number);
    const naming = issues.filter((i) => i.requirements.includes(r.id));
    const doneIssues = naming.filter((i) => i.status === DONE).map((i) => i.number);
    const notDone = naming.filter((i) => i.status !== DONE);
    const openIssues = notDone.map((i) => i.number);
    // Closed on GitHub but never marked Done (#14): still counted as not Done, labelled closed.
    const closedIssues = notDone.filter((i) => i.state === CLOSED).map((i) => i.number);
    const state = !doneIssues.length ? "not-started" : openIssues.length ? "in-progress" : "shipped";
    return { id: r.id, group: r.group, label: r.label, state, prs, openIssues, doneIssues, closedIssues };
  });
  return {
    requirements,
    shipped: requirements.filter((r) => r.state === "shipped").length,
    inProgress: requirements.filter((r) => r.state === "in-progress").length,
    total: requirements.length,
    rule: "every-issue-done",
  };
}
