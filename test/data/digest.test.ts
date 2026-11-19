import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDigest, clientNote, fetchBoard, requirementIds, type BoardIssue, type OpenIssue } from "../../src/fetch/digest.ts";
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

const boardIssue = (n: number, status: string | null, requirements: string[], state = "OPEN"): BoardIssue => ({
  ...issue(n, "", { requirements }),
  status,
  state,
});

describe("buildProgress (D-3, #4: every issue naming the ID is Done)", () => {
  const glossary = {
    requirements: [
      { id: "FR-1", group: "G", label: "One" },
      { id: "FR-2", group: "G", label: "Two" },
      { id: "FR-3", group: "G", label: "Three" },
      { id: "FR-4", group: "G", label: "Four" },
      { id: "FR-5", group: "G", label: "Five" },
      { id: "FR-6", group: "G", label: "Six" },
    ],
  };
  const merged = [pr(5, "2026-11-10T00:00:00Z", { requirements: ["FR-1", "FR-4"] })];
  const issues = [
    boardIssue(1, "Done", ["FR-1"], "CLOSED"),
    boardIssue(2, "Done", ["FR-1", "FR-2"], "CLOSED"),
    boardIssue(3, "Todo", ["FR-2"]),
    boardIssue(4, "Todo", ["FR-3"]),
    boardIssue(5, "In Progress", ["FR-3"]),
    boardIssue(6, null, ["FR-5"]),
    boardIssue(7, "Done", ["FR-5"], "CLOSED"),
    boardIssue(8, "Todo", ["FR-6"], "CLOSED"),
    boardIssue(9, "Done", ["FR-6"], "CLOSED"),
  ];
  const p = buildProgress(glossary, merged, issues);
  const by = (id: string) => p.requirements.find((r) => r.id === id)!;

  it("is shipped when every issue naming it is Done, listing those issues", () => {
    expect(by("FR-1").state).toBe("shipped");
    expect(by("FR-1").doneIssues).toEqual([1, 2]);
    expect(by("FR-1").openIssues).toEqual([]);
    expect(by("FR-1").prs).toEqual([5]);
  });
  it("is in progress when some but not all are Done", () => {
    expect(by("FR-2").state).toBe("in-progress");
    expect(by("FR-2").doneIssues).toEqual([2]);
    expect(by("FR-2").openIssues).toEqual([3]);
  });
  it("is not started when only open, not-Done issues name it", () => {
    expect(by("FR-3").state).toBe("not-started");
    expect(by("FR-3").openIssues).toEqual([4, 5]);
    expect(by("FR-3").doneIssues).toEqual([]);
  });
  it("is not started when no issue names it, even if a merged PR does (prs still listed)", () => {
    expect(by("FR-4").state).toBe("not-started");
    expect(by("FR-4").prs).toEqual([5]);
    expect(by("FR-4").openIssues).toEqual([]);
    expect(by("FR-4").doneIssues).toEqual([]);
  });
  it("counts a null status and a closed-but-not-Done issue as not Done", () => {
    expect(by("FR-5").state).toBe("in-progress");
    expect(by("FR-5").openIssues).toEqual([6]);
    expect(by("FR-6").state).toBe("in-progress");
    expect(by("FR-6").openIssues).toEqual([8]);
    expect(by("FR-6").doneIssues).toEqual([9]);
  });
  it("records the rule and counts that match the states", () => {
    expect(p.rule).toBe("every-issue-done");
    expect([p.shipped, p.inProgress, p.total]).toEqual([1, 3, 6]);
  });
  it("marks everything not started when the board has no issues", () => {
    const empty = buildProgress(glossary, merged, []);
    expect(empty.requirements.every((r) => r.state === "not-started")).toBe(true);
    expect([empty.shipped, empty.inProgress, empty.total, empty.rule]).toEqual([0, 0, 6, "every-issue-done"]);
  });
});

describe("buildProgress closedIssues (D-3, P-7, #14: closed on GitHub but not Done)", () => {
  const glossary = {
    requirements: [
      { id: "FR-1", group: "G", label: "One" },
      { id: "FR-2", group: "G", label: "Two" },
      { id: "FR-3", group: "G", label: "Three" },
      { id: "FR-4", group: "G", label: "Four" },
    ],
  };
  const issues = [
    boardIssue(10, "Todo", ["FR-1"], "CLOSED"),
    boardIssue(11, "Todo", ["FR-1"]),
    boardIssue(12, null, ["FR-1"], "CLOSED"),
    boardIssue(13, "Done", ["FR-1", "FR-2"], "CLOSED"),
    boardIssue(14, "Done", ["FR-2"], "CLOSED"),
    boardIssue(15, "In Progress", ["FR-3"]),
  ];
  const p = buildProgress(glossary, [], issues);
  const by = (id: string) => p.requirements.find((r) => r.id === id)!;

  it("lists a CLOSED not-Done issue in both openIssues and closedIssues, in openIssues order", () => {
    expect(by("FR-1").openIssues).toEqual([10, 11, 12]);
    expect(by("FR-1").closedIssues).toEqual([10, 12]);
  });
  it("keeps an OPEN Todo issue only in openIssues", () => {
    expect(by("FR-1").closedIssues).not.toContain(11);
    expect(by("FR-3").openIssues).toEqual([15]);
    expect(by("FR-3").closedIssues).toEqual([]);
  });
  it("counts a null-status CLOSED issue as closed", () => {
    expect(by("FR-1").closedIssues).toContain(12);
  });
  it("keeps a CLOSED Done issue only in doneIssues", () => {
    expect(by("FR-2").doneIssues).toEqual([13, 14]);
    expect(by("FR-2").openIssues).toEqual([]);
    expect(by("FR-2").closedIssues).toEqual([]);
    expect(by("FR-1").doneIssues).toEqual([13]);
  });
  it("emits an empty closedIssues when no issue names the ID, and when the board is empty", () => {
    expect(by("FR-4").closedIssues).toEqual([]);
    const empty = buildProgress(glossary, [], []);
    expect(empty.requirements.every((r) => Array.isArray(r.closedIssues) && r.closedIssues.length === 0)).toBe(true);
  });
  it("does not change state or counts (closed-not-Done still counts as not Done)", () => {
    expect(p.requirements.map((r) => r.state)).toEqual(["in-progress", "shipped", "not-started", "not-started"]);
    expect([p.shipped, p.inProgress, p.total, p.rule]).toEqual([1, 1, 4, "every-issue-done"]);
  });
});

describe("fetchBoard (D-2, D-3, #4)", () => {
  const page = readFileSync(new URL("./fixtures/board-page.json", import.meta.url), "utf8");
  const stub = (respond: () => Response) =>
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input) !== "https://api.github.com/graphql") throw new Error(`unexpected fetch ${String(input)}`);
      return respond();
    });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns every board issue for this repo (any state) and only the open ones for the digest; other repos are ignored", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    stub(() => new Response(page, { status: 200 }));
    const b = await fetchBoard("o/r", "o", 5);
    expect(b.url).toBe("https://github.com/users/o/projects/5");
    expect(b.issues.map((i) => [i.number, i.state, i.status])).toEqual([[1, "CLOSED", "Done"], [2, "OPEN", "Todo"], [4, "CLOSED", null]]);
    expect(b.open).toEqual([{ number: 2, title: "Hints", url: "https://github.com/o/r/issues/2", status: "Todo", priority: "P1", kind: null, fromClient: true, requirements: ["FR-2"] }]);
    // The other repo's Done issue #3 also names FR-2 but must not count.
    const p = buildProgress({ requirements: [{ id: "FR-2", group: "G", label: "Two" }] }, [], b.issues);
    expect(p.requirements[0]!.doneIssues).toEqual([]);
    expect(p.requirements[0]!.openIssues).toEqual([2]);
    expect(p.requirements[0]!.state).toBe("not-started");
  });
  it("returns empty lists for an empty board", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    stub(() => Response.json({ data: { user: { projectV2: { url: "https://github.com/users/o/projects/5", items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } }));
    const b = await fetchBoard("o/r", "o", 5);
    expect([b.issues, b.open]).toEqual([[], []]);
  });
  it("throws without leaking the token when GitHub fails", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    stub(() => Response.json({ message: "Bad credentials" }, { status: 401 }));
    const err = await fetchBoard("o/r", "o", 5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("test-token");
  });
  it("leaves buildDigest unchanged when the board includes closed issues", async () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    stub(() => new Response(page, { status: 200 }));
    const b = await fetchBoard("o/r", "o", 5);
    const now = new Date("2026-11-16T22:00:00Z");
    const d = buildDigest([], b, now);
    expect(d).toEqual(buildDigest([], { url: b.url, open: b.open }, now));
    expect([d.needsYou, d.inProgress]).toEqual([[], []]);
    expect(d.upNext).toEqual([{ number: 2, title: "Hints", url: "https://github.com/o/r/issues/2", status: "Todo", priority: "P1", kind: null, fromClient: true }]);
  });
});
