import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/page.ts";
import type { Demo, Snapshot } from "../../src/types.ts";

/** Evening demo video card (#6, D-6, P-1, P-2, P-4, P-7, O-4). Wording is the user's, word for word. */

const fixture = (): Snapshot => JSON.parse(readFileSync(new URL("../fixtures/snapshot.json", import.meta.url), "utf8")) as Snapshot;
const withDemo = (demo: Demo | null): Snapshot => ({ ...fixture(), demo });

const SUCCESS: Demo = {
  outcome: "success",
  recordedAt: "2026-11-18T00:41:07Z",
  version: "621270d89f9b95b9632a336fbd63e52574a87f37",
  versionUrl: "https://github.com/daveharmswebdev/chess-tutor/commit/621270d89f9b95b9632a336fbd63e52574a87f37",
  step: null,
  videoUrl: "https://github.com/daveharmswebdev/chess-tutor-dashboard/releases/download/demos/demo-2026-11-17.mp4",
  run: { label: "Run 19400000000", url: "https://github.com/daveharmswebdev/chess-tutor-dashboard/actions/runs/19400000000" },
};
const FAILURE: Demo = { ...SUCCESS, outcome: "failure", step: "the tutor's question" };

// Fixture date is 2026-11-16 in America/Chicago. 23:00Z on the 16th is 5 PM Chicago (same day);
// 12:00Z on the 17th is the next day there.
const TODAY = new Date("2026-11-16T23:00:00Z");
const NEXT_DAY = new Date("2026-11-17T12:00:00Z");

const render = (s: Snapshot, opts: { now?: Date } = { now: TODAY }, isLatest = true) => renderPage(s, [s.date], isLatest, undefined, opts);

/** The HTML of section 01 (Shipped) and 04 (Coming next). */
const section = (html: string, n: string) => {
  const blocks = html.split('<section class="block">').slice(1).map((b) => b.slice(0, b.indexOf("</section>")));
  return blocks.find((b) => b.includes(`${n} · `)) ?? "";
};
const demoCard = (html: string) => section(html, "01").match(/<div class="card pane demo"[\s\S]*?<\/div>\s*$/)?.[0] ?? "";

// Coming next exactly as rendered at base 3f7df37 (fixture repo daveharmswebdev/chess-tutor).
const BASE_COMING_NEXT = `
    <div class="section-head"><span class="section-label">04 · Coming next</span><h2>Two more <em>windows</em> in</h2></div>
    <div class="split">
      <div class="card pane soon"><span class="card-index">Daily</span><h3>Today's demo video</h3><p class="quiet">A short video of the live app each day, with the tutor catching a planned mistake. Being built in <a href="https://github.com/daveharmswebdev/chess-tutor/issues/59" target="_blank" rel="noopener">#59</a>.</p></div>
      <div class="card pane soon"><span class="card-index">Daily</span><h3>Usage and health</h3><p class="quiet">Games played, tutor replies, response times, errors and AI cost for the day. Being built in <a href="https://github.com/daveharmswebdev/chess-tutor/issues/60" target="_blank" rel="noopener">#60</a>.</p></div>
    </div>
  `;

describe("demo absent: snapshot predates the feature (O-4)", () => {
  it("has no demo card in Shipped and Coming next is unchanged from base", () => {
    const s = fixture();
    expect(s.demo).toBeUndefined();
    for (const opts of [{ now: TODAY }, {}]) {
      const html = render(s, opts);
      expect(section(html, "01")).not.toContain("Today's demo video");
      expect(section(html, "01")).not.toContain("<video");
      expect(section(html, "04")).toBe(BASE_COMING_NEXT);
    }
  });
});

describe("demo null: none recorded for this date (P-2)", () => {
  it("today (opts.now on the same calendar day in s.timezone): not run yet", () => {
    const html = render(withDemo(null), { now: TODAY });
    const card = demoCard(html);
    expect(card).toContain("<h3>Today&#39;s demo video</h3>");
    expect(card).toContain("Today&#39;s demo hasn&#39;t run yet. It runs each evening.");
    expect(card).not.toContain("No demo ran this day.");
    expect(card).not.toContain("<video");
  });

  it("an earlier day: no demo ran", () => {
    const card = demoCard(render(withDemo(null), { now: NEXT_DAY }));
    expect(card).toContain("No demo ran this day.");
    expect(card).not.toContain("hasn&#39;t run yet");
  });

  it("uses s.timezone, not UTC, for the calendar day", () => {
    // 2026-11-17T03:00Z is still the 16th in Chicago.
    expect(demoCard(render(withDemo(null), { now: new Date("2026-11-17T03:00:00Z") }))).toContain("hasn&#39;t run yet");
  });

  it("without opts.now falls back to isLatest", () => {
    expect(demoCard(render(withDemo(null), {}, true))).toContain("Today&#39;s demo hasn&#39;t run yet. It runs each evening.");
    expect(demoCard(render(withDemo(null), {}, false))).toContain("No demo ran this day.");
  });
});

describe("demo success (D-6, P-4)", () => {
  it("shows the video, both approved sentences, the recorded time and a linked short sha", () => {
    const card = demoCard(render(withDemo(SUCCESS)));
    expect(card).toContain(`src="${SUCCESS.videoUrl}"`);
    const video = card.match(/<video[^>]*>/)?.[0] ?? "";
    expect(video).toContain(" controls");
    expect(video).toContain('preload="metadata"');
    expect(video).toContain(" playsinline");
    expect(video).not.toContain("autoplay");
    expect(video).toContain('class="demo-video"');
    expect(card).toContain("A short video of the live app each day, with the tutor catching a planned mistake.");
    expect(card).toContain(
      `Recorded on the live app at 6:41 PM, version <a href="${SUCCESS.versionUrl}" target="_blank" rel="noopener">621270d</a>.`,
    );
    expect(card).not.toContain("CST");
    expect(card).not.toContain("failed");
  });

  it("the video comes before the text", () => {
    const card = demoCard(render(withDemo(SUCCESS)));
    expect(card.indexOf("<video")).toBeLessThan(card.indexOf("A short video"));
  });
});

describe("demo failure (P-7: bad news as visible as good)", () => {
  it("drops a leading 'the ' from the step so the sentence reads once", () => {
    const card = demoCard(render(withDemo(FAILURE)));
    expect(card).toContain("Today&#39;s demo failed at the tutor&#39;s question step.");
    expect(card).not.toContain("the the");
    expect(card).not.toContain("A short video of the live app");
  });

  it("keeps a step without 'the ' as is", () => {
    expect(demoCard(render(withDemo({ ...FAILURE, step: "Hint" })))).toContain("Today&#39;s demo failed at the Hint step.");
  });

  it("only strips a lower-case 'the ' prefix", () => {
    expect(demoCard(render(withDemo({ ...FAILURE, step: "The board" })))).toContain("Today&#39;s demo failed at the The board step.");
  });

  it("with no step says the demo failed", () => {
    const card = demoCard(render(withDemo({ ...FAILURE, step: null })));
    expect(card).toContain("Today&#39;s demo failed.");
    expect(card).not.toContain("failed at");
  });

  it("links the run that recorded it", () => {
    const card = demoCard(render(withDemo(FAILURE)));
    expect(card).toContain(`<a href="${FAILURE.run.url}" target="_blank" rel="noopener">Run 19400000000</a>`);
  });

  it("shows a partial video above the text when one was saved", () => {
    const card = demoCard(render(withDemo(FAILURE)));
    expect(card).toContain(`src="${FAILURE.videoUrl}"`);
    expect(card.indexOf("<video")).toBeLessThan(card.indexOf("failed"));
  });

  it("has no video when none was saved", () => {
    const card = demoCard(render(withDemo({ ...FAILURE, videoUrl: null })));
    expect(card).not.toContain("<video");
    expect(card).toContain("Today&#39;s demo failed at the tutor&#39;s question step.");
  });
});

describe("demo strings are untrusted (P-6, P-4)", () => {
  it("escapes the step and run label", () => {
    const s = withDemo({ ...FAILURE, step: `<script>alert(1)</script>`, run: { label: `Run "<b>"`, url: FAILURE.run.url } });
    const html = render(s);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Run &quot;&lt;b&gt;&quot;");
  });

  it("never uses a non-http(s) URL as a src or href, but still shows the text", () => {
    const s = withDemo({ ...SUCCESS, videoUrl: "javascript:alert(1)", versionUrl: "javascript:alert(2)" });
    const html = render(s);
    expect(html).not.toContain("javascript:");
    const card = demoCard(html);
    expect(card).not.toContain("<video");
    expect(card).toContain("A short video of the live app each day, with the tutor catching a planned mistake.");
    expect(card).toContain("Recorded on the live app at 6:41 PM, version 621270d.");
    const f = demoCard(render(withDemo({ ...FAILURE, run: { label: "Run 1", url: "javascript:alert(3)" } })));
    expect(f).not.toContain("javascript:");
    expect(f).toContain("Run 1");
  });

  it("escapes quotes in a URL attribute", () => {
    const html = render(withDemo({ ...SUCCESS, videoUrl: `https://x.test/a.mp4" onerror="alert(1)` }));
    expect(html).not.toContain(`" onerror="`);
    expect(html).toContain("&quot; onerror=&quot;");
  });
});

describe("Coming next once the demo card has left (D-6)", () => {
  it.each([
    ["null", null],
    ["success", SUCCESS],
    ["failure", FAILURE],
  ] as const)("demo %s: one window left, no demo card there", (_name, demo) => {
    const next = section(render(withDemo(demo)), "04");
    expect(next).toContain("<h2>One more <em>window</em> in</h2>");
    expect(next).not.toContain("Two more");
    expect(next).not.toContain("demo video");
    expect(next).toContain("<h3>Usage and health</h3>");
    expect(next).toContain("/issues/60");
    expect(next).not.toContain("/issues/59");
  });

  it("the demo card sits at the end of Shipped", () => {
    const shipped = section(render(withDemo(SUCCESS)), "01");
    expect(shipped.trimEnd().endsWith("</div>")).toBe(true);
    expect(shipped.lastIndexOf("demo-video")).toBeGreaterThan(shipped.lastIndexOf("</details>"));
  });
});
