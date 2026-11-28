import { describe, expect, it } from "vitest";
import { buildProgress, type Glossary } from "../../src/fetch/progress.ts";
import { parseGlossarySource } from "../../src/fetch/glossary-source.ts";
import type { BoardIssue } from "../../src/fetch/digest.ts";

const ROW_KEYS = ["closedIssues", "doneIssues", "group", "id", "label", "openIssues", "prs", "state"];
const boardIssue = (n: number, status: string | null, requirements: string[], state = "OPEN"): BoardIssue => ({
  number: n,
  title: `Issue ${n}`,
  url: `https://github.com/o/r/issues/${n}`,
  status,
  priority: null,
  kind: null,
  fromClient: false,
  requirements,
  state,
});
const issues = [boardIssue(1, "Done", ["FR-1"], "CLOSED"), boardIssue(2, "Todo", ["FR-2"]), boardIssue(3, "Done", ["FR-2"], "CLOSED")];

// The shape chess-tutor's docs/glossary.json has had since #21: excluded entries and events (D-3, P-1).
describe("buildProgress with the mirrored glossary shape (#21, D-3)", () => {
  const mirrored = {
    _note: "x",
    requirements: [
      { id: "FR-1", group: "Playing games", label: "Start a game against the bot as White or Black" },
      { id: "FR-26", excluded: "Plumbing: lets the dashboard confirm the live version." },
      { id: "FR-2", group: "Client dashboard", label: "A recorded demo game shows the tutor at work" },
    ],
    events: [{ code: "deploy.live", label: "A new version of the app went live" }],
  };
  const p = buildProgress(mirrored, [], [...issues, boardIssue(4, "Done", ["FR-26"], "CLOSED")]);

  it("skips excluded entries: not counted and no row", () => {
    expect(p.total).toBe(2);
    expect(p.requirements.map((r) => r.id)).toEqual(["FR-1", "FR-2"]);
    expect([p.shipped, p.inProgress]).toEqual([1, 1]);
  });
  it("keeps exactly the RequirementProgress keys on every row (no 'excluded' leaks)", () => {
    for (const r of p.requirements) expect(Object.keys(r).sort()).toEqual(ROW_KEYS);
  });
  it("copies label and group word for word, in glossary order", () => {
    expect(p.requirements[0]).toMatchObject({ group: "Playing games", label: "Start a game against the bot as White or Black" });
    expect(p.requirements[1]).toMatchObject({ group: "Client dashboard", label: "A recorded demo game shows the tutor at work" });
  });
  it("ignores events", () => {
    const without = buildProgress({ requirements: mirrored.requirements }, [], issues);
    const withEvents = buildProgress(mirrored, [], issues);
    expect(withEvents).toEqual(without);
  });
  it("counts nothing when every entry is excluded", () => {
    const all = buildProgress({ requirements: [{ id: "NFR-18", excluded: "Internal process." }] }, [], issues);
    expect([all.requirements, all.shipped, all.inProgress, all.total]).toEqual([[], 0, 0, 0]);
  });
});

describe("buildProgress with the old glossary shape (no events, no excluded)", () => {
  it("gives the same output as before #21", () => {
    const old = {
      _note: "x",
      requirements: [
        { id: "FR-1", group: "G", label: "One" },
        { id: "FR-2", group: "H", label: "Two" },
      ],
    };
    expect(buildProgress(old, [], issues)).toEqual({
      requirements: [
        { id: "FR-1", group: "G", label: "One", state: "shipped", prs: [], openIssues: [], doneIssues: [1], closedIssues: [] },
        { id: "FR-2", group: "H", label: "Two", state: "in-progress", prs: [], openIssues: [2], doneIssues: [3], closedIssues: [] },
      ],
      shipped: 1,
      inProgress: 1,
      total: 2,
      rule: "every-issue-done",
    });
  });
});

describe("buildProgress on a malformed glossary (P-2: a plain error, never a row with undefined text)", () => {
  const run = (g: unknown) => () => buildProgress(g as Glossary, [], []);
  it("names the ID of a labelled entry without a label", () => {
    expect(run({ requirements: [{ id: "FR-7", group: "G" }] })).toThrow("glossary.json: FR-7 has no label");
  });
  it("names the ID of a labelled entry without a group", () => {
    expect(run({ requirements: [{ id: "FR-8", label: "L" }] })).toThrow("glossary.json: FR-8 has no group");
  });
  it("rejects an empty-string label", () => {
    expect(run({ requirements: [{ id: "FR-9", group: "G", label: "" }] })).toThrow("glossary.json: FR-9 has no label");
  });
  it("names the position of an entry without an id", () => {
    expect(run({ requirements: [{ id: "FR-1", group: "G", label: "L" }, { group: "G", label: "L" }] })).toThrow(
      "glossary.json: requirement 2 has no id",
    );
  });
  it("rejects requirements that is not a list, or is missing", () => {
    expect(run({ requirements: {} })).toThrow("glossary.json: requirements is not a list");
    expect(run({})).toThrow("glossary.json: requirements is not a list");
    expect(run(null)).toThrow("glossary.json: requirements is not a list");
  });
});

describe("parseGlossarySource (#21, P-1, P-2, P-4)", () => {
  const sha = "142f51039e0e2995a889dfacd7190207e3207749";
  const valid = { _note: "Written by the mirror step.", repo: "daveharmswebdev/chess-tutor", path: "docs/glossary.json", commit: sha };

  it("turns a valid file into the exact GlossarySource with its url", () => {
    expect(parseGlossarySource(JSON.stringify(valid))).toEqual({
      source: {
        repo: "daveharmswebdev/chess-tutor",
        path: "docs/glossary.json",
        commit: sha,
        url: `https://github.com/daveharmswebdev/chess-tutor/blob/${sha}/docs/glossary.json`,
      },
      reason: null,
    });
  });
  it("gives a reason and no source when the file is absent", () => {
    expect(parseGlossarySource(null)).toEqual({ source: null, reason: "glossary.source.json not found" });
  });
  it("gives a reason when the file is not JSON", () => {
    expect(parseGlossarySource("{ nope")).toEqual({ source: null, reason: "glossary.source.json is not valid JSON" });
  });
  it("gives a reason when the contents are not an object", () => {
    for (const text of ["null", "[]", '"x"', "42"]) {
      expect(parseGlossarySource(text)).toEqual({ source: null, reason: "glossary.source.json is not an object" });
    }
  });
  it("names a missing, empty or non-text repo, path or commit", () => {
    for (const key of ["repo", "path", "commit"] as const) {
      const rest: Record<string, unknown> = { ...valid };
      delete rest[key];
      const reason = { source: null, reason: `glossary.source.json has no ${key}` };
      expect(parseGlossarySource(JSON.stringify(rest))).toEqual(reason);
      expect(parseGlossarySource(JSON.stringify({ ...valid, [key]: "" }))).toEqual(reason);
      expect(parseGlossarySource(JSON.stringify({ ...valid, [key]: 7 }))).toEqual(reason);
    }
  });
  it("rejects a commit that is not 40 lowercase hex characters (never guesses one)", () => {
    for (const commit of ["142f510", sha.toUpperCase(), `${sha}0`, sha.replace(/^1/, "g")]) {
      expect(parseGlossarySource(JSON.stringify({ ...valid, commit }))).toEqual({
        source: null,
        reason: "glossary.source.json: commit is not a full 40-character commit id",
      });
    }
  });
});
