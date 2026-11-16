import type { Progress, RequirementProgress, ShippedPr } from "../types.ts";
import type { OpenIssue } from "./digest.ts";

export interface Glossary {
  requirements: Array<{ id: string; group: string; label: string }>;
}

/**
 * A requirement counts as "shipped" once at least one merged PR names it, and
 * "in progress" if an open issue names it but no merged PR does yet.
 * This is a mechanical count of references, which the page says in plain words.
 */
export function buildProgress(glossary: Glossary, merged: ShippedPr[], open: OpenIssue[]): Progress {
  const requirements: RequirementProgress[] = glossary.requirements.map((r) => {
    const prs = merged.filter((p) => p.requirements.includes(r.id)).map((p) => p.number);
    const openIssues = open.filter((i) => i.requirements.includes(r.id)).map((i) => i.number);
    const state = prs.length ? "shipped" : openIssues.length ? "in-progress" : "not-started";
    return { ...r, state, prs, openIssues };
  });
  return {
    requirements,
    shipped: requirements.filter((r) => r.state === "shipped").length,
    inProgress: requirements.filter((r) => r.state === "in-progress").length,
    total: requirements.length,
  };
}
