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

describe("renderPage notice for a damaged snapshot (#10, P-2, P-4)", () => {
  it("prints the notice instead of the old-day line, with escaped dates and a link to the damaged file", () => {
    const html = renderPage(fixture(), ["2026-11-17", "2026-11-16"], false, { failedDate: "2026-11-17<x>" });
    expect(html).toContain("The status saved for 2026-11-17&lt;x&gt; could not be opened, so this shows 2026-11-16, the most recent healthy file. ");
    expect(html).toContain("/blob/main/snapshots/2026-11-17&lt;x&gt;.json");
    expect(html).not.toContain("2026-11-17<x>");
    expect(html).not.toContain("You're looking at");
    expect(html).not.toContain("See today");
  });

  it("without a notice the HTML is unchanged", () => {
    expect(renderPage(fixture(), ["2026-11-16", "2026-11-15"], true, undefined)).toBe(renderPage(fixture(), ["2026-11-16", "2026-11-15"], true));
  });
});

describe("renderPage stale warning (#3, P-2, P-7, D-1)", () => {
  // Fixture generatedAt 2026-11-16T21:53:18.953Z in America/Chicago is Monday 3:53 PM.
  const generated = Date.parse("2026-11-16T21:53:18.953Z");
  const at = (ms: number) => new Date(generated + ms);
  const H = 3600 * 1000;
  // The approved sentence, word for word, as it appears in HTML (apostrophes escaped by esc()).
  const SENTENCE = "This page hasn&#39;t updated since Monday 3:53 PM. We&#39;re looking into it.";
  const lastUpdatedTone = (html: string) => html.match(/Last updated<\/span>\s*<span class="metric-value tone-(\w+)"/)?.[1];
  const hasWarning = (html: string) => html.includes('class="stale"');

  it("a latest view 26h 1m old shows the exact sentence at the top of the hero and marks Last updated bad", () => {
    const html = renderPage(fixture(), ["2026-11-16"], true, undefined, { now: at(26 * H + 60_000), requestedDate: false });
    expect(html).toContain(`<p class="stale" role="alert">${SENTENCE}</p>`);
    expect(html.indexOf('class="stale"')).toBeGreaterThan(html.indexOf('<section class="hero'));
    expect(html.indexOf('class="stale"')).toBeLessThan(html.indexOf("<h1>"));
    expect(html.indexOf('class="stale"')).toBeLessThan(html.indexOf('aria-label="Status"'));
    expect(lastUpdatedTone(html)).toBe("bad");
  });

  it("a fresh view (2h) shows no warning and keeps the star tone", () => {
    const html = renderPage(fixture(), ["2026-11-16"], true, undefined, { now: at(2 * H), requestedDate: false });
    expect(hasWarning(html)).toBe(false);
    expect(html).not.toContain("updated since");
    expect(lastUpdatedTone(html)).toBe("star");
  });

  it("exactly 26h is not stale; 26h plus 1 ms is", () => {
    expect(hasWarning(renderPage(fixture(), ["2026-11-16"], true, undefined, { now: at(26 * H), requestedDate: false }))).toBe(false);
    expect(hasWarning(renderPage(fixture(), ["2026-11-16"], true, undefined, { now: at(26 * H + 1), requestedDate: false }))).toBe(true);
  });

  it("a page requested with ?date= is never stale, even when old", () => {
    const html = renderPage(fixture(), ["2026-11-17", "2026-11-16"], false, undefined, { now: at(30 * 24 * H), requestedDate: true });
    expect(hasWarning(html)).toBe(false);
    expect(lastUpdatedTone(html)).toBe("star");
    expect(html).toContain("You're looking at 2026-11-16");
  });

  it("the damaged-file fallback with no date requested shows both the notice and the warning", () => {
    const html = renderPage(fixture(), ["2026-11-17", "2026-11-16"], false, { failedDate: "2026-11-17" }, { now: at(27 * H), requestedDate: false });
    expect(html).toContain("The status saved for 2026-11-17 could not be opened");
    expect(html).toContain(SENTENCE);
    expect(lastUpdatedTone(html)).toBe("bad");
  });

  it("uses the snapshot's timezone, 12-hour time and the long weekday", () => {
    const s = fixture();
    s.generatedAt = "2026-11-17T06:05:00.000Z"; // Tuesday 3:05 PM in Tokyo
    s.timezone = "Asia/Tokyo";
    const html = renderPage(s, [s.date], true, undefined, { now: new Date(Date.parse(s.generatedAt) + 48 * H), requestedDate: false });
    expect(html).toContain("This page hasn&#39;t updated since Tuesday 3:05 PM. We&#39;re looking into it.");
  });

  it("an unparseable generatedAt throws, so the server treats the file as damaged (#10, P-2)", () => {
    const s = fixture();
    s.generatedAt = "not a date";
    expect(() => renderPage(s, [s.date], true, undefined, { now: new Date("2027-01-01T00:00:00Z"), requestedDate: false })).toThrow(Error);
    expect(() => renderPage(s, [s.date], true)).toThrow(Error);
  });

  it("other unparseable timestamps still print unknown (O-4)", () => {
    const s = fixture();
    if (s.status.deploy) s.status.deploy.finishedAt = "not a date";
    const html = renderPage(s, [s.date], true);
    expect(html).not.toMatch(/>\s*(undefined|null|NaN|Invalid Date)\s*</);
  });

  it("without a clock the page shows no warning (unchanged HTML)", () => {
    expect(renderPage(fixture(), ["2026-11-16"], true, undefined, {})).toBe(renderPage(fixture(), ["2026-11-16"], true));
  });
});

describe("progress fine print and evidence links follow Progress.rule (D-3, P-1, P-4, O-4, #4)", () => {
  const OLD_LINE = "A feature counts once a released change names it. Some will still have more to come.";
  const NEW_LINE = "A feature counts as done once every issue for it is marked Done on the project board. If new work is added to a done feature, it goes back to in progress.";
  const panel = (html: string) => {
    const at = html.indexOf("Against the <em>plan</em>");
    const start = html.lastIndexOf("<section", at);
    return html.slice(start, html.indexOf("</section>", at) + "</section>".length);
  };
  const reqRow = (html: string, id: string) => {
    const m = html.match(new RegExp(`<li class="req [^"]*">(?:(?!</li>).)*<span class="rid">${id}</span>(?:(?!</li>).)*</li>`, "s"));
    return m ? m[0] : "";
  };
  const everyIssueDone = (): Snapshot => {
    const s = fixture();
    const base = s.progress.requirements;
    s.progress = {
      ...s.progress,
      rule: "every-issue-done",
      requirements: [
        { ...base[0]!, id: "FR-1", state: "shipped", prs: [25, 24, 19], doneIssues: [5, 6, 23], openIssues: [] },
        { ...base[1]!, id: "FR-8", state: "in-progress", prs: [30, 31, 32, 33], doneIssues: [7, 28, 51, 52, 53], openIssues: [41, 45, 50, 75] },
        { ...base[2]!, id: "FR-9", state: "not-started", prs: [27], doneIssues: [], openIssues: [] },
      ],
    };
    return s;
  };
  const repo = "https://github.com/daveharmswebdev/chess-tutor";
  const link = (path: string, text: string) => `<a href="${repo}/${path}" target="_blank" rel="noopener">${text}</a>`;

  it("with rule every-issue-done, prints the approved sentence word for word and not the old line", () => {
    const html = panel(renderPage(everyIssueDone(), ["2026-11-16"], true));
    expect(html).toContain(`<p class="fine">${NEW_LINE}</p>`);
    expect(html).not.toContain(OLD_LINE);
  });

  it("with rule every-issue-done, links done issues (first 3 then +k) and open issues, never PRs", () => {
    const html = panel(renderPage(everyIssueDone(), ["2026-11-16"], true));
    expect(html).not.toContain("/pull/");
    const fr1 = reqRow(html, "FR-1");
    for (const n of [5, 6, 23]) expect(fr1).toContain(link(`issues/${n}`, `#${n}`));
    const fr8 = reqRow(html, "FR-8");
    expect(fr8).toContain(
      `<span class="refs">${link("issues/7", "#7")} ${link("issues/28", "#28")} ${link("issues/51", "#51")} <span class="mono-label">+2</span> ${link("issues/41", "#41 open")} ${link("issues/45", "#45 open")}</span>`,
    );
  });

  it("with rule every-issue-done, a not-started row with PRs but no issues shows no links", () => {
    const fr9 = reqRow(panel(renderPage(everyIssueDone(), ["2026-11-16"], true)), "FR-9");
    expect(fr9).toContain(`<span class="refs"></span>`);
    expect(fr9).not.toContain("<a ");
  });

  it("with rule every-issue-done but doneIssues missing on a row, renders without crashing (O-4)", () => {
    const s = everyIssueDone();
    delete s.progress.requirements[0]!.doneIssues;
    const html = panel(renderPage(s, ["2026-11-16"], true));
    expect(html).not.toMatch(/>\s*(undefined|null|NaN)\s*</);
    expect(reqRow(html, "FR-1")).toContain(`<span class="refs"></span>`);
  });

  it("without a rule (older snapshots), keeps the old line and PR links", () => {
    const html = panel(renderPage(fixture(), ["2026-11-16"], true));
    expect(html).toContain(`<p class="fine">${OLD_LINE}</p>`);
    expect(html).not.toContain(NEW_LINE);
    expect(reqRow(html, "FR-1")).toContain(`<span class="refs">${link("pull/25", "#25")} ${link("pull/24", "#24")} ${link("pull/19", "#19")}</span>`);
  });
});
