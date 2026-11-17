import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/page.ts";
import type { Snapshot } from "../../src/types.ts";

/**
 * Every committed snapshot must still render (O-4, P-5). Files are read from disk only;
 * nothing here touches the network (P-6) or writes to snapshots/.
 */
const dir = new URL("../../snapshots/", import.meta.url);
const dates = readdirSync(dir)
  .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
  .filter((d): d is string => d !== undefined)
  .sort()
  .reverse();
const newest = dates[0];

function load(date: string): Snapshot {
  return JSON.parse(readFileSync(new URL(`${date}.json`, dir), "utf8")) as Snapshot;
}

/** The checks every rendered day must pass. Exported shape kept local so the test stays one file. */
function checkRendered(html: string, date: string): void {
  expect(html.trim().length).toBeGreaterThan(0);
  expect(html).toContain("</html>");
  expect(html).not.toMatch(/>\s*(undefined|null|NaN)\s*</);
  expect(html).not.toMatch(/="(undefined|null|NaN)"/);
  expect(html).not.toContain("[object Object]");
  // renderPage always prints the day in the footer's raw-data link: snapshots/<s.date>.json
  expect(html).toContain(`/snapshots/${date}.json"`);
}

describe("committed snapshots (O-4, P-5)", () => {
  it("finds at least one committed snapshot", () => {
    expect(dates.length).toBeGreaterThan(0);
  });

  it.each(dates)("renders snapshots/%s.json", (date) => {
    const s = load(date);
    expect(s.date).toBe(date);
    let html = "";
    expect(() => {
      html = renderPage(s, dates, date === newest);
    }).not.toThrow();
    checkRendered(html, date);
  });
});
