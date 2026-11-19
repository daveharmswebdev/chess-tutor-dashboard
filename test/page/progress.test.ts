import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/page.ts";
import type { RequirementProgress, Snapshot } from "../../src/types.ts";

/**
 * Remaining (not-Done) issue refs in the Progress panel (#14, D-3, P-1, P-4, P-7, O-4).
 * A closed-but-not-Done issue reads "#n closed"; more than two remaining issues show the
 * first two and then "+k", the same overflow markup as the Done refs.
 */
const fixture = (): Snapshot => JSON.parse(readFileSync(new URL("../fixtures/snapshot.json", import.meta.url), "utf8")) as Snapshot;
const repo = "https://github.com/daveharmswebdev/chess-tutor";
const link = (n: number, text: string) => `<a href="${repo}/issues/${n}" target="_blank" rel="noopener">${text}</a>`;

/** A one-requirement every-issue-done snapshot built from the fixture. */
function withRow(row: Partial<RequirementProgress>): Snapshot {
  const s = fixture();
  const base = s.progress.requirements[0]!;
  s.progress = {
    ...s.progress,
    rule: "every-issue-done",
    requirements: [{ ...base, id: "FR-5", state: "in-progress", prs: [], doneIssues: [], openIssues: [], ...row }],
  };
  return s;
}

const refs = (s: Snapshot) => {
  const html = renderPage(s, [s.date], true);
  const m = html.match(/<span class="rid">FR-5<\/span><\/span><span class="refs">(.*?)<\/span><\/li>/s);
  return m ? m[1]! : "<row not found>";
};

describe("remaining issue refs: closed label and +k (#14)", () => {
  it("labels a closed-not-Done issue '#n closed' and the other '#n open', each linking to its issue", () => {
    const r = refs(withRow({ openIssues: [12, 13], closedIssues: [12] }));
    expect(r).toBe(`${link(12, "#12 closed")} ${link(13, "#13 open")}`);
    expect(r).not.toContain("#12 open");
  });

  it("with five remaining issues, shows two refs then exactly +3", () => {
    const r = refs(withRow({ openIssues: [21, 22, 23, 24, 25] }));
    expect(r).toBe(`${link(21, "#21 open")} ${link(22, "#22 open")} <span class="mono-label">+3</span>`);
  });

  it("with exactly two remaining issues, shows no +k", () => {
    const r = refs(withRow({ openIssues: [21, 22], closedIssues: [] }));
    expect(r).toBe(`${link(21, "#21 open")} ${link(22, "#22 open")}`);
    expect(r).not.toContain("+");
  });

  it("without closedIssues (an older snapshot), labels every ref open and still counts +k (O-4)", () => {
    const s = withRow({ openIssues: [12, 13, 14] });
    delete s.progress.requirements[0]!.closedIssues;
    const r = refs(s);
    expect(r).toBe(`${link(12, "#12 open")} ${link(13, "#13 open")} <span class="mono-label">+1</span>`);
    expect(r).not.toContain("closed");
  });

  it("a closed issue beyond the first two is not shown but is counted in +k", () => {
    const r = refs(withRow({ openIssues: [31, 32, 33], closedIssues: [33] }));
    expect(r).toBe(`${link(31, "#31 open")} ${link(32, "#32 open")} <span class="mono-label">+1</span>`);
    expect(r).not.toContain("#33");
  });

  it("follows done refs and their own +k in order", () => {
    const r = refs(withRow({ doneIssues: [1, 2, 3, 4], openIssues: [12, 13, 14], closedIssues: [13] }));
    expect(r).toBe(
      `${link(1, "#1")} ${link(2, "#2")} ${link(3, "#3")} <span class="mono-label">+1</span> ${link(12, "#12 open")} ${link(13, "#13 closed")} <span class="mono-label">+1</span>`,
    );
  });

  it("applies to older snapshots without a rule too (open issues next to PR refs)", () => {
    const s = withRow({ prs: [40], openIssues: [12, 13, 14, 15] });
    delete s.progress.rule;
    expect(refs(s)).toBe(`<a href="${repo}/pull/40" target="_blank" rel="noopener">#40</a> ${link(12, "#12 open")} ${link(13, "#13 open")} <span class="mono-label">+2</span>`);
  });
});
