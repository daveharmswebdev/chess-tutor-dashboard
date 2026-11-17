import type { BoardItem, Demo, RequirementProgress, ShippedPr, Snapshot } from "./types.ts";

const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const a = (url: string | null | undefined, text: string, cls = "") =>
  url ? `<a href="${esc(url)}"${cls ? ` class="${cls}"` : ""} target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);

// An unparseable timestamp prints "unknown" rather than throwing, so every snapshot still renders (O-4).
// Some ICU versions put a narrow no-break space before AM/PM; print a plain space.
const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(d).replace(/[  ]/g, " ");
};
const time = (iso: string | null | undefined, tz: string) => (iso ? fmt(iso, tz, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "unknown");
const day = (iso: string | null | undefined, tz: string) => (iso ? fmt(iso, tz, { weekday: "short", month: "short", day: "numeric" }) : "unknown");
const when = (iso: string | null | undefined, tz: string) => (iso ? `${day(iso, tz)}, ${time(iso, tz)}` : "unknown");

type Tone = "good" | "bad" | "warn" | "muted" | "star";

function metric(label: string, value: string, tone: Tone, detail: string): string {
  return `<div class="metric">
    <span class="mono-label">${esc(label)}</span>
    <span class="metric-value tone-${tone}">${esc(value)}</span>
    <div class="metric-detail">${detail}</div>
  </div>`;
}

function statusStrip(s: Snapshot, stale: boolean): string {
  const { status, timezone: tz } = s;
  const h = status.health;
  const app = !h
    ? metric("The app", "Not checked", "muted", "No app address set yet")
    : metric("The app", h.ok ? "Up" : "Down", h.ok ? "good" : "bad",
        `${status.appUrl ? a(status.appUrl, "Open the app") + " · " : ""}${h.ok ? `answered in ${h.ms} ms` : esc(h.httpStatus ? `health check returned ${h.httpStatus}` : h.error)}`);

  const d = status.deploy;
  const live = d
    ? metric("Version live", d.commit?.slice(0, 7) ?? "unknown", d.status === "live" ? "star" : d.status.includes("fail") ? "bad" : "warn",
        `${a(d.commitUrl, d.commitMessage ?? "View commit")}<br>${d.status === "live" ? "Deployed" : esc(d.status.replace(/_/g, " "))} ${esc(when(d.finishedAt, tz))}`)
    : metric("Version live", "Unavailable", "muted", esc(status.deployUnavailable));

  const ci = status.ci;
  const tests = ci
    ? metric("Automated tests", ci.conclusion === "success" ? "Passing" : (ci.conclusion ?? "Unknown"), ci.conclusion === "success" ? "good" : "bad",
        `${a(ci.url, "Latest run on main")} · ${esc(when(ci.finishedAt, tz))}`)
    : metric("Automated tests", "Unavailable", "muted", "");

  const updated = metric("Last updated", time(s.generatedAt, tz).replace(/ [A-Z]{2,4}$/, ""), stale ? "bad" : "star", esc(`${day(s.generatedAt, tz)} · ${time(s.generatedAt, tz).split(" ").pop()}`));

  return `<section class="strip gap-grid-segmented" aria-label="Status">${app}${live}${tests}${updated}</section>`;
}

function sectionHead(n: string, label: string, title: string): string {
  return `<div class="section-head"><span class="section-label">${esc(n)} · ${esc(label)}</span><h2>${title}</h2></div>`;
}

function prRow(p: ShippedPr, tz: string): string {
  const words = p.clientNote
    ? esc(p.clientNote)
    : `${esc(p.title)} <span class="tag" title="Plain-language client notes on every change are being added (chess-tutor #61). Until then this is the change's title.">PR title</span>`;
  return `<li class="row">
    <span class="row-date"><span class="row-day">${esc(fmt(p.mergedAt, tz, { day: "numeric" }))}</span><span class="mono-label">${esc(fmt(p.mergedAt, tz, { month: "short" }))}</span></span>
    <span class="row-body"><span class="row-title">${words}</span><span class="mono-label">${esc(time(p.mergedAt, tz))}</span></span>
    ${a(p.url, `#${p.number} →`, "row-link btn-ghost")}
  </li>`;
}

function itemRow(i: BoardItem): string {
  const tags = [i.priority, i.kind].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`);
  if (i.fromClient) tags.push(`<span class="tag tag-star">Your request</span>`);
  return `<li class="item">${a(i.url, i.title)}<div class="item-meta"><span class="mono-label">#${i.number}</span> ${tags.join(" ")}</div></li>`;
}

/** Only http(s) addresses may become a src or href; anything else is dropped (P-4, P-6). */
const httpUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

const RELEASE_ASSET_PATH = /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.mp4$/;

/**
 * The one rule for "this demo has a playable video" (#18, P-6), shared with the server's /demo route:
 * an https GitHub Release .mp4 asset on github.com itself (no other host, port or credentials).
 * The page draws the player only when this holds; the server fetches only such a URL.
 */
export function demoVideoSource(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "github.com" && u.port === "" && !u.username && !u.password && RELEASE_ASSET_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of `d` in `tz`, to compare with Snapshot.date. */
const calendarDate = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

// Approved wording (#6), word for word.
function demoText(d: Demo, tz: string): string {
  if (d.outcome === "success") {
    const at = fmt(d.recordedAt, tz, { hour: "numeric", minute: "2-digit" });
    const sha = d.version ? d.version.slice(0, 7) : "unknown";
    return `<p class="quiet">${esc("A short video of the live app each day, with the tutor catching a planned mistake.")}</p>
    <p class="quiet">${esc(`Recorded on the live app at ${at}, version `)}${a(httpUrl(d.versionUrl), sha)}.</p>`;
  }
  const step = d.step === null ? null : d.step.startsWith("the ") ? d.step.slice(4) : d.step;
  const sentence = step === null ? "Today's demo failed." : `Today's demo failed at the ${step} step.`;
  return `<p class="demo-failed">${esc(sentence)} ${a(httpUrl(d.run.url), d.run.label)}</p>`;
}

/** The evening demo card (#6, D-6). Only rendered when the snapshot carries the demo field (O-4). */
function demoCard(s: Snapshot, isToday: boolean): string {
  const d = s.demo;
  let body: string;
  if (!d) {
    body = `<p class="quiet">${esc(isToday ? "Today's demo hasn't run yet. It runs each evening." : "No demo ran this day.")}</p>`;
  } else {
    // The server serves the file itself with headers iOS will play (#18); the GitHub URL stays server-side.
    const video = demoVideoSource(d.videoUrl)
      ? `<video class="demo-video" src="${esc(`/demo/${s.date}.mp4`)}" controls preload="metadata" playsinline aria-label="${esc("Today's demo video")}"></video>`
      : "";
    body = `${video}${demoText(d, s.timezone)}`;
  }
  return `<div class="card pane demo"><h3>${esc("Today's demo video")}</h3>${body}</div>`;
}

function shipped(s: Snapshot, isToday: boolean): string {
  const d = s.digest;
  const tz = s.timezone;
  const today = d.shippedToday.length
    ? `<ul class="rows">${d.shippedToday.map((p) => prRow(p, tz)).join("")}</ul>`
    : `<p class="quiet">Nothing new went live in the last 24 hours. Quiet days are usually testing and groundwork; what's in progress is listed below.</p>`;
  const week = d.shippedThisWeek.length
    ? `<details class="fold"${d.shippedToday.length ? "" : " open"}><summary><span class="mono-label">Earlier this week</span> <span class="count">${d.shippedThisWeek.length}</span></summary><ul class="rows">${d.shippedThisWeek.map((p) => prRow(p, tz)).join("")}</ul></details>`
    : "";
  return `<section class="block">${sectionHead("01", "Shipped", "What went <em>live</em>")}${today}${week}${s.demo === undefined ? "" : demoCard(s, isToday)}</section>`;
}

function work(s: Snapshot): string {
  const d = s.digest;
  const needs = d.needsYou.length
    ? `<ul class="items">${d.needsYou.map(itemRow).join("")}</ul>`
    : `<p class="quiet">Nothing needs a decision from you today.</p>`;
  const handling = [...d.inProgress, ...d.upNext];
  return `<section class="block">
    ${sectionHead("02", "The work", "Who's <em>holding</em> what")}
    <div class="split">
      <div class="card pane ${d.needsYou.length ? "pane-needs" : ""}">
        <span class="card-index">For you</span>
        <h3>Needs a decision from you</h3>
        ${needs}
      </div>
      <div class="card pane">
        <span class="card-index">For us</span>
        <h3>We're handling it</h3>
        ${d.inProgress.length ? `<p class="mono-label sub">In progress</p><ul class="items">${d.inProgress.map(itemRow).join("")}</ul>` : ""}
        ${d.upNext.length ? `<p class="mono-label sub">Up next</p><ul class="items">${d.upNext.map(itemRow).join("")}</ul>` : ""}
        ${handling.length ? "" : `<p class="quiet">The work queue is empty.</p>`}
        <p class="pane-foot">${a(d.boardUrl, "See the full project board", "btn-ghost")}</p>
      </div>
    </div>
  </section>`;
}

function progress(s: Snapshot): string {
  const p = s.progress;
  const pct = (n: number) => (p.total ? (100 * n) / p.total : 0);
  const groups = [...new Set(p.requirements.map((r) => r.group))];
  const repoUrl = `https://github.com/${s.repo}`;
  const everyIssueDone = p.rule === "every-issue-done";
  const row = (r: RequirementProgress) => {
    const mark = r.state === "shipped" ? "●" : r.state === "in-progress" ? "◐" : "○";
    // Evidence matches the rule that decided the state: done board issues under "every-issue-done",
    // merged PRs for older snapshots (P-1, O-4).
    const done = everyIssueDone ? (r.doneIssues ?? []) : r.prs;
    const path = everyIssueDone ? "issues" : "pull";
    const refs = [
      ...done.slice(0, 3).map((n) => a(`${repoUrl}/${path}/${n}`, `#${n}`)),
      ...(done.length > 3 ? [`<span class="mono-label">+${done.length - 3}</span>`] : []),
      ...r.openIssues.slice(0, 2).map((n) => a(`${repoUrl}/issues/${n}`, `#${n} open`)),
    ].join(" ");
    return `<li class="req ${r.state}"><span class="mark" aria-hidden="true">${mark}</span><span>${esc(r.label)} <span class="rid">${esc(r.id)}</span></span><span class="refs">${refs}</span></li>`;
  };
  const group = (g: string) => {
    const rs = p.requirements.filter((r) => r.group === g);
    const done = rs.filter((r) => r.state === "shipped").length;
    return `<details class="fold group"><summary><span class="group-name">${esc(g)}</span><span class="count">${done}/${rs.length}</span></summary><ul class="reqs">${rs.map(row).join("")}</ul></details>`;
  };
  return `<section class="block">
    ${sectionHead("03", "Progress", "Against the <em>plan</em>")}
    <div class="progress-head">
      <div><span class="metric-value big">${p.shipped}<span class="of">/${p.total}</span></span><span class="mono-label">Planned features with shipped work</span></div>
      <div class="progress-side">
        <div class="bar" role="img" aria-label="${p.shipped} of ${p.total} shipped, ${p.inProgress} in progress">
          <span class="bar-shipped" style="width:${pct(p.shipped)}%"></span><span class="bar-inprog" style="width:${pct(p.inProgress)}%"></span>
        </div>
        <p class="legend"><span class="key key-shipped"></span>${p.shipped} shipped <span class="key key-inprog"></span>${p.inProgress} in progress <span class="key"></span>${p.total - p.shipped - p.inProgress} not started</p>
        <p class="fine">${everyIssueDone
          ? "A feature counts as done once every issue for it is marked Done on the project board. If new work is added to a done feature, it goes back to in progress."
          : "A feature counts once a released change names it. Some will still have more to come."}</p>
      </div>
    </div>
    <div class="groups">${groups.map(group).join("")}</div>
  </section>`;
}

function comingNext(s: Snapshot): string {
  const issue = (n: number) => a(`https://github.com/${s.repo}/issues/${n}`, `#${n}`);
  // Once the snapshot carries the demo field, the demo card lives in Shipped (#6).
  const demoShipped = s.demo !== undefined;
  return `<section class="block">
    ${sectionHead("04", "Coming next", demoShipped ? "One more <em>window</em> in" : "Two more <em>windows</em> in")}
    <div class="split">
${demoShipped ? "" : `      <div class="card pane soon"><span class="card-index">Daily</span><h3>Today's demo video</h3><p class="quiet">A short video of the live app each day, with the tutor catching a planned mistake. Being built in ${issue(59)}.</p></div>
`}      <div class="card pane soon"><span class="card-index">Daily</span><h3>Usage and health</h3><p class="quiet">Games played, tutor replies, response times, errors and AI cost for the day. Being built in ${issue(60)}.</p></div>
    </div>
  </section>`;
}

/** Set when the requested day's file could not be opened and an earlier day is shown instead (#10). */
export interface RenderNotice {
  failedDate: string;
}

export interface RenderOptions {
  /** The current time. Without it the page is never marked stale. */
  now?: Date;
  /** True when the request named an older day than the newest (?date=): viewing history on purpose is never stale. */
  requestedDate?: boolean;
}

/** Strictly more than 26 hours: two missed runs of the twice-daily Snapshot Action (#3). */
const STALE_MS = 26 * 3600 * 1000;

/** True when the default view shows a snapshot generated more than 26 hours before `now`. */
function isStale(s: Snapshot, opts: RenderOptions): boolean {
  if (!opts.now || opts.requestedDate) return false;
  return opts.now.getTime() - Date.parse(s.generatedAt) > STALE_MS;
}

export function renderPage(s: Snapshot, history: string[], isLatest: boolean, notice?: RenderNotice, opts: RenderOptions = {}): string {
  const tz = s.timezone;
  // A snapshot without a real generation time cannot be dated; the server treats it as damaged (#10).
  if (Number.isNaN(Date.parse(s.generatedAt))) throw new Error("snapshot generatedAt is not a valid timestamp");
  const stale = isStale(s, opts);
  // Approved wording (#3), word for word.
  const staleBand = stale
    ? `<p class="stale" role="alert">${esc(`This page hasn't updated since ${fmt(s.generatedAt, tz, { weekday: "long" })} ${fmt(s.generatedAt, tz, { hour: "numeric", minute: "2-digit", hour12: true })}. We're looking into it.`)}</p>`
    : "";
  const longDate = fmt(s.generatedAt, tz, { weekday: "long", month: "long", day: "numeric" });
  const hist = history
    .slice(0, 14)
    .map((d) => (d === s.date ? `<span class="hist-current">${esc(d)}</span>` : `<a href="/?date=${esc(d)}">${esc(d)}</a>`))
    .join("");
  const dashRepo = process.env.DASHBOARD_REPO ?? "daveharmswebdev/chess-tutor-dashboard";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chess Tutor · Daily status</title>
<meta name="theme-color" content="#161228">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;700&display=swap">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
  <div class="container topbar-inner">
    <img src="/logo.svg" alt="FortyAU" class="logo" width="88" height="21">
    <span class="mono-label topbar-title">Client status</span>
    <span class="mono-label topbar-time">Updated ${esc(time(s.generatedAt, tz))}</span>
  </div>
</header>
<main>
  <section class="hero glow">
    <div class="container">
      ${staleBand}
      <span class="section-label">Chess Tutor · ${esc(longDate)}</span>
      <h1>The build, <em>today</em>.</h1>
      <p class="lede">What's live, what changed, and what needs you. Every line links to where it came from.</p>
      ${notice
        ? `<p class="old">The status saved for ${esc(notice.failedDate)} could not be opened, so this shows ${esc(s.date)}, the most recent healthy file. ${a(`https://github.com/${dashRepo}/blob/main/snapshots/${notice.failedDate}.json`, "damaged file")}</p>`
        : isLatest ? "" : `<p class="old">You're looking at ${esc(s.date)}. <a href="/">See today</a></p>`}
      ${statusStrip(s, stale)}
    </div>
  </section>
  <div class="container">
    ${shipped(s, opts.now ? calendarDate(opts.now, tz) === s.date : isLatest)}
    ${work(s)}
    ${progress(s)}
    ${comingNext(s)}
  </div>
</main>
<footer class="footer">
  <div class="container footer-inner">
    <div class="footer-claim">
      <img src="/logo.svg" alt="FortyAU" class="logo" width="88" height="21">
      <p>Every fact on this page is copied from GitHub, Render or a committed file. <em>Nothing here is written by AI.</em></p>
    </div>
    <div class="footer-meta">
      <p class="mono-label">Source</p>
      <p>${a(`https://github.com/${dashRepo}/blob/main/snapshots/${s.date}.json`, "This day's raw data")}${s.run ? ` · ${a(s.run.url, s.run.label)}` : ""}</p>
      <p class="fine">Generated ${esc(when(s.generatedAt, tz))}</p>
    </div>
    ${history.length > 1 ? `<div class="footer-meta"><p class="mono-label">Earlier days</p><p class="history">${hist}</p></div>` : ""}
  </div>
</footer>
<div class="grain" aria-hidden="true"></div>
</body>
</html>`;
}
