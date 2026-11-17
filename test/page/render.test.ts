import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/page.ts";
import type { Snapshot } from "../../src/types.ts";

const fixture = (): Snapshot => JSON.parse(readFileSync(new URL("../fixtures/snapshot.json", import.meta.url), "utf8")) as Snapshot;

/** Every link on the page must point somewhere real (P-4: every claim links to its source). */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]!);
}

describe("renderPage (D-1..D-4)", () => {
  it("renders the fixture snapshot with every panel and no leaked undefined/null", () => {
    const html = renderPage(fixture(), ["2026-11-16"], true);
    for (const text of ["The app", "Version live", "Automated tests", "Last updated", "What went", "Needs a decision from you", "We're handling it", "Against the", "Today's demo video", "Usage and health"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/>\s*(undefined|null|NaN)\s*</);
    expect(html).not.toContain("[object Object]");
  });

  it("links every fact to a source, with no empty or javascript: links", () => {
    const links = hrefs(renderPage(fixture(), ["2026-11-16", "2026-11-15"], true));
    expect(links.length).toBeGreaterThan(10);
    for (const h of links) expect(h).toMatch(/^(https:\/\/|\/\?date=|\/$)/);
  });

  it("escapes text that came from GitHub (titles, notes)", () => {
    const s = fixture();
    s.digest.shippedToday = [{ number: 1, title: `<img src=x onerror=alert(1)>`, url: "https://github.com/o/r/pull/1", mergedAt: s.generatedAt, clientNote: null, requirements: [] }];
    const html = renderPage(s, [s.date], true);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("degrades honestly when sources are missing (P-2)", () => {
    const s = fixture();
    s.status = { appUrl: null, health: null, deploy: null, deployUnavailable: "Render connection not set up yet", ci: null };
    s.digest.shippedToday = [];
    s.digest.needsYou = [];
    const html = renderPage(s, [s.date], true);
    expect(html).toContain("Not checked");
    expect(html).toContain("Render connection not set up yet");
    expect(html).toContain("Nothing new went live in the last 24 hours");
    expect(html).toContain("Nothing needs a decision from you today");
  });

  it("marks an earlier day as not today (P-5)", () => {
    expect(renderPage(fixture(), ["2026-11-17", "2026-11-16"], false)).toContain("See today");
  });
});
