import { describe, expect, it } from "vitest";
import { planDemo, plannedAt } from "../../src/fetch/demo.ts";

// Pure arithmetic on the snapshot date and two repo variables (#29, D-6): no network, no clock.
describe("plannedAt (#29)", () => {
  it("defaults to 16:00 America/Chicago: CST in November, CDT in July", () => {
    expect(plannedAt("2026-11-18", {})).toBe("2026-11-18T22:00:00.000Z");
    expect(plannedAt("2026-07-15", {})).toBe("2026-07-15T21:00:00.000Z");
  });

  it("treats empty strings (unset Actions variables) as the defaults", () => {
    expect(plannedAt("2026-11-18", { DEMO_TIME: "", DEMO_TZ: "" })).toBe("2026-11-18T22:00:00.000Z");
  });

  it("uses DEMO_TIME and DEMO_TZ when set", () => {
    expect(plannedAt("2026-11-18", { DEMO_TIME: "16:00", DEMO_TZ: "America/Chicago" })).toBe("2026-11-18T22:00:00.000Z");
    expect(plannedAt("2026-11-18", { DEMO_TIME: "09:05", DEMO_TZ: "Europe/Berlin" })).toBe("2026-11-18T08:05:00.000Z");
    expect(plannedAt("2026-07-15", { DEMO_TIME: "09:05", DEMO_TZ: "Europe/Berlin" })).toBe("2026-07-15T07:05:00.000Z");
    expect(plannedAt("2026-11-18", { DEMO_TIME: "09:05", DEMO_TZ: "Asia/Kolkata" })).toBe("2026-11-18T03:35:00.000Z");
    expect(plannedAt("2026-11-18", { DEMO_TIME: "00:00", DEMO_TZ: "Asia/Kolkata" })).toBe("2026-11-17T18:30:00.000Z");
    expect(plannedAt("2026-11-18", { DEMO_TIME: "23:59", DEMO_TZ: "UTC" })).toBe("2026-11-18T23:59:00.000Z");
  });

  it("handles the DST change days in America/Chicago", () => {
    // Spring forward 2026-03-08: 16:00 is already CDT.
    expect(plannedAt("2026-03-08", {})).toBe("2026-03-08T21:00:00.000Z");
    // Fall back 2026-11-01: 16:00 is already CST.
    expect(plannedAt("2026-11-01", {})).toBe("2026-11-01T22:00:00.000Z");
    // 01:30 happens twice on 2026-11-01 (CDT 06:30Z, then CST 07:30Z): the earlier instant.
    expect(plannedAt("2026-11-01", { DEMO_TIME: "01:30" })).toBe("2026-11-01T06:30:00.000Z");
  });

  it("returns null for a wall-clock time skipped by spring forward", () => {
    expect(plannedAt("2027-03-14", { DEMO_TIME: "02:30" })).toBeNull();
    const plan = planDemo("2027-03-14", { DEMO_TIME: "02:30" });
    expect(plan.at).toBeNull();
    expect(plan.at === null && plan.reason).toMatch(/02:30.*America\/Chicago.*2027-03-14/);
  });

  it.each(["4pm", "24:00", "9:05", "16:60", " 16:00"])("returns null for DEMO_TIME %j", (time) => {
    expect(plannedAt("2026-11-18", { DEMO_TIME: time })).toBeNull();
    const plan = planDemo("2026-11-18", { DEMO_TIME: time });
    expect(plan.at === null && plan.reason).toMatch(/DEMO_TIME/);
  });

  it.each(["America", "Mars/Base"])("returns null for DEMO_TZ %j", (zone) => {
    expect(plannedAt("2026-11-18", { DEMO_TZ: zone })).toBeNull();
    const plan = planDemo("2026-11-18", { DEMO_TZ: zone });
    expect(plan.at === null && plan.reason).toMatch(/DEMO_TZ/);
  });

  it("returns null for a malformed date", () => {
    expect(plannedAt("2026-13-01", {})).toBeNull();
    expect(plannedAt("not-a-date", {})).toBeNull();
  });
});
