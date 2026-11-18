/**
 * The evening demo video (#6, D-6): the logic behind scripts/demo-wait.ts, scripts/demo-result.ts
 * and the `demo` field of scripts/snapshot.ts. Network, clock, sleep and file reads are injected
 * so the tests run without the network (P-6). Nothing here writes or rewords client text (P-1):
 * the only words copied from chess-tutor are the failure step, verbatim.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Demo } from "../types.ts";

type Env = Record<string, string | undefined>;

const SHA = /^[0-9a-f]{40}$/;
const short = (sha: string) => sha.slice(0, 7);
const REQUEST_TIMEOUT_MS = 30_000;
const IN_PROGRESS = new Set(["created", "queued", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"]);

// ---------------------------------------------------------------- waiting for the live version

export interface WaitDeps {
  env: Env;
  fetch: typeof fetch;
  now: () => number; // ms since epoch
  sleep: (ms: number) => Promise<void>;
}

// url: the app address whose health confirmed the version (the demo runs against exactly this app).
export type WaitResult = { ok: true; version: string; url: string } | { ok: false; reason: string };

/** The lines demo-wait appends to $GITHUB_OUTPUT: `version=` then `url=`. */
export function githubOutput(result: { version: string; url: string }): string {
  return `version=${result.version}\nurl=${result.url}\n`;
}

interface RenderService {
  service: { id: string; name: string; serviceDetails?: { url?: string } };
}
interface RenderDeploy {
  deploy: { status: string; commit?: { id: string } };
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Plain words for a failed request; never includes headers or the key (P-6). */
function failure(err: unknown): string {
  return (err as Error)?.name === "TimeoutError" ? "no answer within 30 s" : "could not connect";
}

type Health = { commit: string; seen: string } | { commit: null; seen: string };

async function checkHealth(f: typeof fetch, appUrl: string): Promise<Health> {
  let res: Response;
  try {
    res = await f(new URL("/api/health", appUrl).toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    return { commit: null, seen: `health check: ${failure(err)}` };
  }
  if (!res.ok) return { commit: null, seen: `health check returned HTTP ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { commit: null, seen: "health check answer was not JSON" };
  }
  const b = (body ?? {}) as { ok?: unknown; commit?: unknown };
  if (b.ok !== true) return { commit: null, seen: "health check did not report ok" };
  if (typeof b.commit !== "string" || !SHA.test(b.commit)) return { commit: null, seen: "health check reported no commit" };
  return { commit: b.commit, seen: `health reported commit ${short(b.commit)}` };
}

async function render<T>(f: typeof fetch, path: string, key: string): Promise<T> {
  let res: Response;
  try {
    res = await f(`https://api.render.com/v1${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(failure(err));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("answer was not JSON");
  }
}

/**
 * Polls until the live app settles on its newest version (rule in brief 012 / issue #6):
 * health is 2xx with ok === true and a 40-hex commit, and, when RENDER_API_KEY is set, the newest
 * Render deploy is not in progress and, if it is live, its commit equals the health commit.
 * A failed deploy leaves the old version serving, so the health commit is accepted then.
 * A failing request is just another poll. Times out after DEMO_WAIT_MINUTES.
 */
export async function waitForLiveVersion(deps: WaitDeps): Promise<WaitResult> {
  const { env, now, sleep } = deps;
  const f = deps.fetch;
  const pollMs = positive(env.DEMO_POLL_SECONDS, 20) * 1000;
  const waitMinutes = positive(env.DEMO_WAIT_MINUTES, 20);
  const deadline = now() + waitMinutes * 60_000;
  const key = env.RENDER_API_KEY || null;
  const serviceName = env.RENDER_SERVICE_NAME || "chess-tutor";
  let service: { id: string; url: string | null } | null = null;
  let lastSeen = "nothing yet";

  for (;;) {
    const seen: string[] = [];
    let deployReady = true;
    let deployCommit: string | null = null; // set only when the newest deploy is live

    if (key) {
      try {
        if (!service) {
          const services = await render<RenderService[]>(f, `/services?name=${encodeURIComponent(serviceName)}&limit=1`, key);
          const svc = services[0]?.service;
          if (!svc) throw new Error(`no service named ${serviceName}`);
          service = { id: svc.id, url: svc.serviceDetails?.url ?? null };
        }
        const deploys = await render<RenderDeploy[]>(f, `/services/${service.id}/deploys?limit=1`, key);
        const d = deploys[0]?.deploy;
        if (d) {
          const sha = d.commit?.id ?? null;
          seen.push(`newest Render deploy ${d.status}${sha ? ` at ${short(sha)}` : ""}`);
          if (IN_PROGRESS.has(d.status)) deployReady = false;
          else if (d.status === "live") deployCommit = sha;
        } else {
          seen.push("Render lists no deploys");
        }
      } catch (err) {
        deployReady = false;
        seen.push(`Render could not be reached (${(err as Error).message})`);
      }
    }

    const appUrl = env.APP_URL || service?.url || null; // an unset Actions variable arrives as ""
    if (appUrl) {
      const health = await checkHealth(f, appUrl);
      seen.unshift(health.seen);
      if (health.commit && deployReady && (deployCommit === null || deployCommit === health.commit)) {
        return { ok: true, version: health.commit, url: appUrl };
      }
    } else {
      seen.unshift("no app address (APP_URL is empty and Render gave none)");
    }

    lastSeen = seen.join("; ");
    if (now() + pollMs > deadline) break;
    await sleep(pollMs);
  }

  const minutes = `${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}`;
  return { ok: false, reason: `The live app did not settle within ${minutes}. Last seen: ${lastSeen}.` };
}

// ---------------------------------------------------------------- the demo result

export interface ResultDeps {
  env: Env;
  readLog: (path: string) => Promise<string>;
  now: () => Date;
}

// CSI escape sequences (colours, bold, cursor moves) that test runners put in their output.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const STEP = /demo stopped at (.+?): /;

/** The <step> from chess-tutor's first "demo stopped at <step>: <reason>", word for word, or null. */
export function findStep(log: string): string | null {
  const step = STEP.exec(log.replace(ANSI, ""))?.[1] ?? null;
  return step !== null && step.trim() !== "" ? step : null; // a blank step is no step
}

function runLink(env: Env): Demo["run"] {
  const id = env.GITHUB_RUN_ID;
  const repository = env.GITHUB_REPOSITORY;
  if (!id || !repository) throw new Error("GITHUB_RUN_ID and GITHUB_REPOSITORY must be set (demo-result runs in GitHub Actions)");
  return { label: `Run ${id}`, url: `${env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/runs/${id}` };
}

const LATE_AFTER_MS = 30 * 60_000;

/**
 * The planned start of a scheduled recording (#22, P-7), from DEMO_PLANNED_AT and DEMO_STARTED_AT
 * (ISO timestamps set by the workflow). Null when DEMO_PLANNED_AT is empty or unset (a manual run).
 * A bad DEMO_PLANNED_AT, or a planned time without a valid DEMO_STARTED_AT, throws (P-2).
 */
function plannedStart(env: Env): Demo["planned"] | null {
  const plannedAt = env.DEMO_PLANNED_AT ?? "";
  if (plannedAt === "") return null;
  const planned = Date.parse(plannedAt);
  if (Number.isNaN(planned)) throw new Error("DEMO_PLANNED_AT must be an ISO timestamp");
  const started = Date.parse(env.DEMO_STARTED_AT ?? "");
  if (Number.isNaN(started)) throw new Error("DEMO_STARTED_AT must be an ISO timestamp when DEMO_PLANNED_AT is set");
  return { at: new Date(planned).toISOString(), late: started - planned > LATE_AFTER_MS };
}

/** Builds one Demo from the Demo workflow's step outcomes (rule in brief 012 / issue #6). */
export async function buildDemoResult(deps: ResultDeps): Promise<Demo> {
  const { env } = deps;
  const run = runLink(env);
  const planned = plannedStart(env);
  const repo = env.TARGET_REPO || "daveharmswebdev/chess-tutor";
  const videoUrlEnv = env.DEMO_VIDEO_URL ?? "";
  const allSucceeded = env.LIVE_OUTCOME === "success" && env.DEMO_OUTCOME === "success" && env.UPLOAD_OUTCOME === "success";
  const version = env.DEMO_VERSION && SHA.test(env.DEMO_VERSION) ? env.DEMO_VERSION : null;

  let step: string | null = null;
  if (env.DEMO_OUTCOME === "failure" && env.DEMO_LOG) {
    try {
      step = findStep(await deps.readLog(env.DEMO_LOG));
    } catch {
      step = null; // no log, no step: the run log still has the details
    }
  }

  return {
    outcome: allSucceeded && videoUrlEnv !== "" ? "success" : "failure",
    recordedAt: deps.now().toISOString(),
    version,
    versionUrl: version ? `https://github.com/${repo}/commit/${version}` : null,
    step,
    videoUrl: env.UPLOAD_OUTCOME === "success" && videoUrlEnv !== "" ? videoUrlEnv : null,
    run,
    ...(planned ? { planned } : {}), // absent, not null, on a manual run
  };
}

// ---------------------------------------------------------------- validation and carry-over

const nullableString = (v: unknown) => v === null || typeof v === "string";

/** Checks an untrusted value is a Demo; throws a plain error naming the bad field otherwise. */
export function parseDemo(value: unknown, source = "demo result"): Demo {
  const bad = (field: string): never => {
    throw new Error(`Invalid ${source}: ${field}`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) bad("not an object");
  const v = value as Record<string, unknown>;
  if (v.outcome !== "success" && v.outcome !== "failure") bad("outcome must be success or failure");
  if (typeof v.recordedAt !== "string" || Number.isNaN(Date.parse(v.recordedAt))) bad("recordedAt must be a timestamp");
  if (!(v.version === null || (typeof v.version === "string" && SHA.test(v.version)))) bad("version must be a 40-hex sha or null");
  if (!nullableString(v.versionUrl)) bad("versionUrl must be a string or null");
  if (!(v.step === null || (typeof v.step === "string" && v.step.trim() !== ""))) bad("step must be a non-empty string or null");
  if (!nullableString(v.videoUrl)) bad("videoUrl must be a string or null");
  const r = v.run as Record<string, unknown> | null | undefined;
  if (typeof r !== "object" || r === null || typeof r.label !== "string" || typeof r.url !== "string") bad("run must be { label, url }");
  let planned: Demo["planned"];
  if ("planned" in v) {
    const p = v.planned as Record<string, unknown> | null;
    if (typeof p !== "object" || p === null || Array.isArray(p) || typeof p.at !== "string" || Number.isNaN(Date.parse(p.at)) || typeof p.late !== "boolean") {
      bad("planned must be { at, late }");
    }
    planned = { at: p!.at as string, late: p!.late as boolean };
  }
  return {
    outcome: v.outcome as Demo["outcome"],
    recordedAt: v.recordedAt as string,
    version: v.version as string | null,
    versionUrl: v.versionUrl as string | null,
    step: v.step as string | null,
    videoUrl: v.videoUrl as string | null,
    run: { label: r!.label as string, url: r!.url as string },
    ...(planned ? { planned } : {}),
  };
}

export interface LoadDemoOptions {
  resultFile: string | undefined; // $DEMO_RESULT_FILE
  snapshotsDir: string;
  date: string; // YYYY-MM-DD of the snapshot being written
}

/**
 * The `demo` for the snapshot being written: the Demo workflow's result file when given (a bad
 * file throws), else the demo already recorded in the same date's snapshot (a later Snapshot run
 * that evening must not wipe the video), else null. Another day's demo is never carried over.
 */
export async function loadSnapshotDemo(opts: LoadDemoOptions): Promise<Demo | null> {
  if (opts.resultFile) {
    let text: string;
    try {
      text = await readFile(opts.resultFile, "utf8");
    } catch {
      throw new Error(`Could not read the demo result file ${opts.resultFile}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Invalid demo result: ${opts.resultFile} is not JSON`);
    }
    return parseDemo(parsed);
  }

  const path = join(opts.snapshotsDir, `${opts.date}.json`);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const existing = JSON.parse(text) as { date?: unknown; demo?: unknown };
  if (existing.date !== opts.date || existing.demo === undefined || existing.demo === null) return null;
  return parseDemo(existing.demo, `demo in ${path}`);
}

// ---------------------------------------------------------------- the planned recording time (#29)

const DEMO_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type DemoPlan = { at: string } | { at: null; reason: string };

/** The wall-clock fields of `ms` in `zone`, as if they were UTC (ms since epoch). */
function wallClock(format: Intl.DateTimeFormat, ms: number): number {
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

/**
 * Today's planned demo start: DEMO_TIME (HH:MM, default 16:00) in DEMO_TZ (IANA, default
 * America/Chicago) on `date` (YYYY-MM-DD), as an ISO UTC instant. An empty variable means the
 * default (an unset Actions variable arrives as ""). In the fall-back hour the earlier instant wins;
 * a time skipped by spring forward has no instant. Matches GNU `date -u -d 'TZ="zone" date time'`.
 */
export function planDemo(date: string, env: Env): DemoPlan {
  const time = env.DEMO_TIME || "16:00";
  const zone = env.DEMO_TZ || "America/Chicago";
  if (!DEMO_TIME.test(time)) return { at: null, reason: `DEMO_TIME "${time}" is not HH:MM (24-hour)` };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return { at: null, reason: `DEMO_TZ "${zone}" is not a known time zone` };
  }
  const d = DATE.exec(date);
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const target = d ? Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hh, mm) : NaN;
  if (!d || new Date(target).toISOString().slice(0, 10) !== date) return { at: null, reason: `snapshot date "${date}" is not YYYY-MM-DD` };
  // Offsets in force around the target: an instant is a candidate when its wall clock equals the target.
  const offsets = new Set([-DAY_MS, -HOUR_MS * 3, 0, HOUR_MS * 3, DAY_MS].map((delta) => wallClock(format, target + delta) - (target + delta)));
  const hits = [...offsets].map((offset) => target - offset).filter((ms) => wallClock(format, ms) === target);
  if (hits.length === 0) return { at: null, reason: `${time} does not exist in ${zone} on ${date} (clocks skip it)` };
  return { at: new Date(Math.min(...hits)).toISOString() };
}

/** planDemo without the reason: the ISO instant, or null when the config or the day has none. */
export function plannedAt(date: string, env: Env): string | null {
  return planDemo(date, env).at;
}
