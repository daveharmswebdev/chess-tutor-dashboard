import { describe, expect, it } from "vitest";
import { buildDigest, clientNote, requirementIds, type OpenIssue } from "../../src/fetch/digest.ts";
import { buildProgress } from "../../src/fetch/progress.ts";
import type { ShippedPr } from "../../src/types.ts";

const pr = (n: number, mergedAt: string, extra: Partial<ShippedPr> = {}): ShippedPr => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  mergedAt,
  clientNote: null,
  requirements: [],
  ...extra,
});
const issue = (n: number, status: string, extra: Partial<OpenIssue> = {}): OpenIssue => ({
  number: n,
  title: `Issue ${n}`,
  url: `https://github.com/o/r/issues/${n}`,
  status,
  priority: null,
  kind: null,
  fromClient: false,
  requirements: [],
  ...extra,
});

describe("clientNote (D-2: printed word for word)", () => {
  it("takes the first paragraph under a 'Client note' heading, any level or case", () => {
    expect(clientNote("## What changed\n- x\n\n## Client note\nYou can now save games.\n\nMore.\n\n## Tests\n- ok")).toBe("You can now save games.");
    expect(clientNote("### CLIENT NOTE\n  Faster  replies.  ")).toBe("Faster replies.");
  });
  it("is null when the section is missing, empty, or only a template comment", () => {
    expect(clientNote(null)).toBeNull();
    expect(clientNote("## What changed\nstuff")).toBeNull();
    expect(clientNote("## Client note\n<!-- one plain sentence -->\n\n## Tests")).toBeNull();
  });
});

describe("requirementIds", () => {
  it("finds FR/NFR IDs once each, and ignores look-alikes", () => {
    expect(requirementIds("Implements FR-25 and FR-10 (FR-25 again), NFR-14.")).toEqual(["FR-25", "FR-10", "NFR-14"]);
    expect(requirementIds("XFR-1 FR-x")).toEqual([]);
    expect(requirementIds(null)).toEqual([]);
  });
});

describe("buildDigest (D-2, P-3)", () => {
  const now = new Date("2026-11-16T22:00:00Z");
  const merged = [pr(3, "2026-11-16T20:00:00Z"), pr(2, "2026-11-14T10:00:00Z"), pr(1, "2026-11-01T10:00:00Z")];
  const board = {
    url: "https://github.com/users/o/projects/5",
    open: [
      issue(10, "Needs you"),
      issue(11, "In Progress"),
      issue(12, "In Review"),
      issue(13, "Todo", { priority: "P3" }),
      issue(14, "Todo", { priority: "P1" }),
      issue(15, "Todo", { kind: "Epic" }),
    ],
  };
  const d = buildDigest(merged, board, now);

  it("splits shipped work into the last 24 hours and the rest of the week", () => {
    expect(d.shippedToday.map((p) => p.number)).toEqual([3]);
    expect(d.shippedThisWeek.map((p) => p.number)).toEqual([2]);
  });
  it("separates 'needs you' from 'we're handling it', and orders up-next by priority without Epics", () => {
    expect(d.needsYou.map((i) => i.number)).toEqual([10]);
    expect(d.inProgress.map((i) => i.number)).toEqual([11, 12]);
    expect(d.upNext.map((i) => i.number)).toEqual([14, 13]);
  });
});

describe("buildProgress (D-3)", () => {
  it("counts a requirement shipped once a merged PR names it, in progress if only an open issue does", () => {
    const glossary = { requirements: [{ id: "FR-1", group: "G", label: "One" }, { id: "FR-2", group: "G", label: "Two" }, { id: "FR-3", group: "G", label: "Three" }] };
    const p = buildProgress(glossary, [pr(5, "2026-11-10T00:00:00Z", { requirements: ["FR-1"] })], [issue(9, "Todo", { requirements: ["FR-2"] })]);
    expect(p.requirements.map((r) => r.state)).toEqual(["shipped", "in-progress", "not-started"]);
    expect(p.requirements[0]!.prs).toEqual([5]);
    expect([p.shipped, p.inProgress, p.total]).toEqual([1, 1, 3]);
  });
});
