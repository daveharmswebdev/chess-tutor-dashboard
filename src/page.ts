import type { BoardItem, RequirementProgress, ShippedPr, Snapshot } from "./types.ts";

const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const a = (url: string | null | undefined, text: string, cls = "") =>
  url ? `<a href="${esc(url)}"${cls ? ` class="${cls}"` : ""} target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);

function when(iso: string | null | undefined, tz: string, withDate = true): string {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const pill = (tone: "good" | "bad" | "warn" | "muted", text: string) => `<span class="pill ${tone}">${esc(text)}</span>`;

function statusStrip(s: Snapshot): string {
  const { status, timezone: tz } = s;
  const h = status.health;
  const up = !h ? pill("muted", "Not checked") : h.ok ? pill("good", "Up") : pill("bad", "Down");
  const upDetail = !h ? "No app address set yet" : h.ok ? `Answered in ${h.ms} ms` : `Health check ${h.httpStatus ? `returned ${h.httpStatus}` : h.error}`;

  const d = status.deploy;
  const live = d
    ? `${d.status === "live" ? pill("good", "Live") : pill(d.status.includes("fail") ? "bad" : "warn", d.status.replace(/_/g, " "))}
       <div class="detail">${a(d.commitUrl, d.commit?.slice(0, 7) ?? "unknown")} · ${esc(d.commitMessage ?? "")}</div>
       <div class="detail">Deployed ${esc(when(d.finishedAt, tz))}</div>`
    : `${pill("muted", "Unavailable")}<div class="detail">${esc(status.deployUnavailable)}</div>`;

  const ci = status.ci;
  const tests = ci
    ? `${ci.conclusion === "success" ? pill("good", "Passing") : pill("bad", ci.conclusion ?? "unknown")}
       <div class="detail">${a(ci.url, "Latest run on main")} · ${esc(when(ci.finishedAt, tz))}</div>`
    : pill("muted", "Unavailable");

  return `
  <section class="strip" aria-label="Status">
    <div class="cell">
      <h3>The app</h3>
      ${up}
      <div class="detail">${status.appUrl ? a(status.appUrl, "Open the app") + " · " : ""}${esc(upDetail)}</div>
    </div>
    <div class="cell"><h3>Version live</h3>${live}</div>
    <div class="cell"><h3>Automated tests</h3>${tests}</div>
    <div class="cell"><h3>Last updated</h3><div class="big">${esc(when(s.generatedAt, tz, false))}</div><div class="detail">${esc(when(s.generatedAt, tz).split(",").slice(0, 2).join(","))}</div></div>
  </section>`;
}

function prLine(p: ShippedPr, tz: string): string {
  const words = p.clientNote
    ? `<span class="note">${esc(p.clientNote)}</span>`
    : `<span class="note">${esc(p.title)}</span> <span class="tag" title="Client notes on every change are being added (chess-tutor #61). Until then this is the change's title.">title</span>`;
  return `<li>${words}<div class="detail">${a(p.url, `#${p.number}`)} · ${esc(when(p.mergedAt, tz))}</div></li>`;
}

function itemLine(i: BoardItem): string {
  const tags = [i.priority, i.kind, i.fromClient ? "your request" : null].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ");
  return `<li>${a(i.url, i.title)} ${tags}<div class="detail">#${i.number}${i.status ? ` · ${esc(i.status)}` : ""}</div></li>`;
}

function digest(s: Snapshot): string {
  const d = s.digest;
  const tz = s.timezone;
  const today = d.shippedToday.length
    ? `<ul class="list">${d.shippedToday.map((p) => prLine(p, tz)).join("")}</ul>`
    : `<p class="quiet">Nothing new went live in the last 24 hours. Quiet days are usually testing and groundwork; anything in progress is listed below.</p>`;
  const week = d.shippedThisWeek.length
    ? `<details${d.shippedToday.length ? "" : " open"}><summary>Earlier this week (${d.shippedThisWeek.length})</summary><ul class="list">${d.shippedThisWeek.map((p) => prLine(p, tz)).join("")}</ul></details>`
    : "";

  const needs = d.needsYou.length
    ? `<ul class="list">${d.needsYou.map(itemLine).join("")}</ul>`
    : `<p class="quiet">Nothing needs a decision from you today.</p>`;

  const handling = [...d.inProgress, ...d.upNext];
  return `
  <section class="card">
    <h2>What shipped today</h2>
    ${today}
    ${week}
  </section>
  <section class="split">
    <div class="card needs ${d.needsYou.length ? "has" : ""}">
      <h2>Needs a decision from you</h2>
      ${needs}
    </div>
    <div class="card">
      <h2>We're handling it</h2>
      ${d.inProgress.length ? `<h4>In progress</h4><ul class="list">${d.inProgress.map(itemLine).join("")}</ul>` : ""}
      ${d.upNext.length ? `<h4>Up next</h4><ul class="list">${d.upNext.map(itemLine).join("")}</ul>` : ""}
      ${handling.length ? "" : `<p class="quiet">The work queue is empty.</p>`}
      <p class="detail">${a(d.boardUrl, "See the full project board")}</p>
    </div>
  </section>`;
}

function progress(s: Snapshot): string {
  const p = s.progress;
  const pct = (n: number) => (p.total ? (100 * n) / p.total : 0);
  const groups = [...new Set(p.requirements.map((r) => r.group))];
  const repoUrl = `https://github.com/${s.repo}`;
  const row = (r: RequirementProgress) => {
    const mark = r.state === "shipped" ? "✓" : r.state === "in-progress" ? "◐" : "○";
    const refs = [
      ...r.prs.slice(0, 3).map((n) => a(`${repoUrl}/pull/${n}`, `#${n}`)),
      ...(r.prs.length > 3 ? [`+${r.prs.length - 3}`] : []),
      ...r.openIssues.slice(0, 2).map((n) => a(`${repoUrl}/issues/${n}`, `#${n} open`)),
    ].join(" ");
    return `<li class="req ${r.state}"><span class="mark" aria-hidden="true">${mark}</span><span>${esc(r.label)} <span class="rid">${esc(r.id)}</span></span><span class="refs">${refs}</span></li>`;
  };
  return `
  <section class="card">
    <h2>Progress against the plan</h2>
    <div class="bar" role="img" aria-label="${p.shipped} of ${p.total} shipped, ${p.inProgress} in progress">
      <span class="shipped" style="width:${pct(p.shipped)}%"></span><span class="inprog" style="width:${pct(p.inProgress)}%"></span>
    </div>
    <p class="legend"><b>${p.shipped}</b> of ${p.total} planned features have shipped work · <b>${p.inProgress}</b> in progress · ${p.total - p.shipped - p.inProgress} not started</p>
    <p class="detail">A feature counts as having shipped work once a released change names it. Some will still have more to come.</p>
    ${groups.map((g) => `<details><summary>${esc(g)} (${p.requirements.filter((r) => r.group === g && r.state === "shipped").length}/${p.requirements.filter((r) => r.group === g).length})</summary><ul class="reqs">${p.requirements.filter((r) => r.group === g).map(row).join("")}</ul></details>`).join("")}
  </section>`;
}

function comingNext(s: Snapshot): string {
  const issue = (n: number) => a(`https://github.com/${s.repo}/issues/${n}`, `#${n}`);
  return `
  <section class="split">
    <div class="card soon">
      <h2>Today's demo video</h2>
      <p class="quiet">Coming next: a short daily video of the live app, with the tutor catching a planned mistake. Being built in ${issue(59)}.</p>
    </div>
    <div class="card soon">
      <h2>Usage and health</h2>
      <p class="quiet">Coming next: games played, tutor replies, response times, errors and AI cost for the day. Being built in ${issue(60)}.</p>
    </div>
  </section>`;
}

export function renderPage(s: Snapshot, history: string[], isLatest: boolean): string {
  const tz = s.timezone;
  const hist = history
    .slice(0, 14)
    .map((d) => (d === s.date ? `<b>${esc(d)}</b>` : `<a href="/?date=${esc(d)}">${esc(d)}</a>`))
    .join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chess Tutor · Daily status</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <header>
    <p class="eyebrow">Chess Tutor build</p>
    <h1>Daily status, ${esc(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(s.generatedAt)))}</h1>
    ${isLatest ? "" : `<p class="old">You're looking at an earlier day. <a href="/">See today</a>.</p>`}
  </header>
  ${statusStrip(s)}
  ${digest(s)}
  ${progress(s)}
  ${comingNext(s)}
  <footer>
    <p>Every fact on this page is copied from GitHub, Render or a committed file. Nothing here is written by AI. Each item links to its source.</p>
    <p>${a(`https://github.com/${process.env.DASHBOARD_REPO ?? "daveharmswebdev/chess-tutor-dashboard"}/blob/main/snapshots/${s.date}.json`, "This day's raw data")}${s.run ? ` · produced by ${a(s.run.url, s.run.label)}` : ""} · generated ${esc(when(s.generatedAt, tz))}</p>
    ${history.length > 1 ? `<p class="history">Earlier days: ${hist}</p>` : ""}
  </footer>
</main>
</body>
</html>`;
}
