import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/page.ts";
import type { GlossarySource, Snapshot } from "../../src/types.ts";

/** #21 (P-4, O-4): the footer links to the chess-tutor commit the feature wording was copied from. */
const fixture = (): Snapshot => JSON.parse(readFileSync(new URL("../fixtures/snapshot.json", import.meta.url), "utf8")) as Snapshot;

const source: GlossarySource = {
  repo: "daveharmswebdev/chess-tutor",
  path: "docs/glossary.json",
  commit: "142f51039e0e2995a889dfacd7190207e3207749",
  url: "https://github.com/daveharmswebdev/chess-tutor/blob/142f51039e0e2995a889dfacd7190207e3207749/docs/glossary.json",
};

const footer = (html: string) => html.slice(html.indexOf("<footer"), html.indexOf("</footer>") + "</footer>".length);
const sourceLine = (html: string) => /<p class="mono-label">Source<\/p>\s*<p>(.*?)<\/p>/s.exec(html)![1]!;

const raw = `<a href="https://github.com/daveharmswebdev/chess-tutor-dashboard/blob/main/snapshots/2026-11-16.json" target="_blank" rel="noopener">This day&#39;s raw data</a>`;
const run = `<a href="https://github.com/daveharmswebdev/chess-tutor-dashboard/actions/runs/43964541153" target="_blank" rel="noopener">Run 43964541153</a>`;
const wording = `<a href="${source.url}" target="_blank" rel="noopener">Feature wording</a>`;

// The fixture's footer as rendered at 1395336 (before #21), byte for byte.
const baseFooter = `<footer class="footer">
  <div class="container footer-inner">
    <div class="footer-claim">
      <img src="/logo.svg" alt="FortyAU" class="logo" width="88" height="21">
      <p>Every fact on this page is copied from GitHub, Render or a committed file. <em>Nothing here is written by AI.</em></p>
    </div>
    <div class="footer-meta">
      <p class="mono-label">Source</p>
      <p>${raw} · ${run}</p>
      <p class="fine">Generated Mon, Nov 16, 3:53 PM CST</p>
    </div>
    <div class="footer-meta"><p class="mono-label">Earlier days</p><p class="history"><span class="hist-current">2026-11-16</span><a href="/?date=2026-11-15">2026-11-15</a></p></div>
  </div>
</footer>`;

const baseFooterNoRun = `<footer class="footer">
  <div class="container footer-inner">
    <div class="footer-claim">
      <img src="/logo.svg" alt="FortyAU" class="logo" width="88" height="21">
      <p>Every fact on this page is copied from GitHub, Render or a committed file. <em>Nothing here is written by AI.</em></p>
    </div>
    <div class="footer-meta">
      <p class="mono-label">Source</p>
      <p>${raw}</p>
      <p class="fine">Generated Mon, Nov 16, 3:53 PM CST</p>
    </div>
${"    "}
  </div>
</footer>`;

describe("footer feature-wording link (#21, P-4, O-4)", () => {
  it("links the glossary source after the run link", () => {
    const html = renderPage({ ...fixture(), glossarySource: source }, ["2026-11-16"], true);
    expect(sourceLine(html)).toBe(`${raw} · ${run} · ${wording}`);
  });

  it("follows the raw data link directly when there is no run", () => {
    const html = renderPage({ ...fixture(), run: null, glossarySource: source }, ["2026-11-16"], true);
    expect(sourceLine(html)).toBe(`${raw} · ${wording}`);
  });

  it("leaves the footer byte-for-byte unchanged when glossarySource is absent (older snapshots)", () => {
    const s = fixture();
    expect(s.glossarySource).toBeUndefined();
    expect(footer(renderPage(s, ["2026-11-16", "2026-11-15"], true))).toBe(baseFooter);
    expect(footer(renderPage({ ...s, run: null }, ["2026-11-16"], true))).toBe(baseFooterNoRun);
    expect(renderPage(s, ["2026-11-16"], true)).not.toContain("Feature wording");
  });

  it("escapes a url containing a quote", () => {
    const url = `https://github.com/x/y/blob/abc/docs/g.json"><script>alert(1)</script>`;
    const html = renderPage({ ...fixture(), glossarySource: { ...source, url } }, ["2026-11-16"], true);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(sourceLine(html)).toContain(`href="https://github.com/x/y/blob/abc/docs/g.json&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`);
  });

  it("every committed snapshot still renders, with the link only where glossarySource is present", () => {
    const dir = new URL("../../snapshots/", import.meta.url);
    const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Snapshot;
      const html = renderPage(s, [s.date], true);
      expect(html).toContain("</html>");
      expect(html.includes(">Feature wording</a>")).toBe(s.glossarySource !== undefined);
    }
  });
});
