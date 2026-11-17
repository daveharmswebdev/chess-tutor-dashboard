import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnapshotDemo } from "../../src/fetch/demo.ts";
import { snapshotDate } from "../../src/fetch/snapshot-date.ts";

const TZ = "America/Chicago";
// 00:10 on Nov 18 in Chicago: a manual Demo run that started on Nov 17 finishes after midnight.
const AFTER_MIDNIGHT = new Date("2026-11-18T06:10:00Z");

describe("snapshotDate (D-6, P-5)", () => {
  it("is today's date in the timezone when SNAPSHOT_DATE is unset", () => {
    expect(snapshotDate({}, AFTER_MIDNIGHT, TZ)).toBe("2026-11-18");
  });

  it('ignores an empty SNAPSHOT_DATE (an unset Actions output arrives as "")', () => {
    expect(snapshotDate({ SNAPSHOT_DATE: "" }, AFTER_MIDNIGHT, TZ)).toBe("2026-11-18");
  });

  it("uses SNAPSHOT_DATE when set", () => {
    expect(snapshotDate({ SNAPSHOT_DATE: "2026-11-17" }, AFTER_MIDNIGHT, TZ)).toBe("2026-11-17");
  });

  it.each(["2026-13-01", "2026-02-30", "2026-00-10", "tomorrow", "2026-11-1", " 2026-11-17", "2026-11-17T00:00"])("throws on SNAPSHOT_DATE %j", (d) => {
    expect(() => snapshotDate({ SNAPSHOT_DATE: d }, AFTER_MIDNIGHT, TZ)).toThrow(/SNAPSHOT_DATE/);
  });

  it("accepts a leap day", () => {
    expect(snapshotDate({ SNAPSHOT_DATE: "2028-02-29" }, AFTER_MIDNIGHT, TZ)).toBe("2028-02-29");
  });

  it("drives the carry-over lookup: SNAPSHOT_DATE's file is read, not today's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snapdate-test-"));
    try {
      await mkdir(join(dir, "snapshots"));
      const demo = { outcome: "success", recordedAt: "2026-11-18T06:05:00.000Z", version: null, versionUrl: null, step: null, videoUrl: "https://v", run: { label: "Run 1", url: "https://r" } };
      await writeFile(join(dir, "snapshots", "2026-11-17.json"), JSON.stringify({ date: "2026-11-17", demo }));
      const date = snapshotDate({ SNAPSHOT_DATE: "2026-11-17" }, AFTER_MIDNIGHT, TZ);
      expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: join(dir, "snapshots"), date })).toEqual(demo);
      const today = snapshotDate({}, AFTER_MIDNIGHT, TZ);
      expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: join(dir, "snapshots"), date: today })).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
