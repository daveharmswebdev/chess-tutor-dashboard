import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDemoResult, loadSnapshotDemo, parseDemo, waitForLiveVersion, type WaitDeps } from "../../src/fetch/demo.ts";
import type { Demo } from "../../src/types.ts";

const SHA_OLD = "de786d065b37d71837993a520e1bb57eee7cecba";
const SHA_NEW = "621270d0a1b2c3d4e5f60718293a4b5c6d7e8f90";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Route = (call: number) => Response | Promise<Response>;

/** A fetch stub routed by URL substring; any other URL rejects, so no test reaches the network (P-6). */
function stubFetch(routes: Record<string, Route>) {
  const calls: Record<string, number> = {};
  const urls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    for (const [part, respond] of Object.entries(routes)) {
      if (url.includes(part)) {
        calls[part] = (calls[part] ?? 0) + 1;
        return respond(calls[part]!);
      }
    }
    throw new Error(`unexpected network call in test: ${url}`);
  }) as typeof fetch;
  return { fn, calls, urls };
}

/** A fake clock that only moves when the waiter sleeps. */
function deps(fetchFn: typeof fetch, env: Record<string, string | undefined>): WaitDeps & { slept: number[] } {
  let t = Date.parse("2026-11-18T00:30:00Z");
  const slept: number[] = [];
  return {
    env,
    fetch: fetchFn,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

const service = json([{ service: { id: "srv-1", name: "chess-tutor", serviceDetails: { url: "https://svc.example" } } }]);
const deploy = (status: string, sha: string) => json([{ deploy: { status, finishedAt: null, commit: { id: sha, message: "m" } } }]);
const health = (sha: string) => json({ ok: true, engine: "ready", commit: sha });

describe("waitForLiveVersion (D-6, O-1)", () => {
  it("returns the health commit at once when health and the live deploy agree", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": () => deploy("live", SHA_OLD),
      "app.example/api/health": () => health(SHA_OLD),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "k", APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_OLD });
    expect(d.slept).toEqual([]);
  });

  it("waits while the newest deploy is in progress, then returns the deploy's commit once it is live", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": (n) => (n === 1 ? deploy("build_in_progress", SHA_NEW) : n === 2 ? deploy("update_in_progress", SHA_NEW) : deploy("live", SHA_NEW)),
      "app.example/api/health": (n) => (n <= 2 ? health(SHA_OLD) : health(SHA_NEW)),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "k", APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_NEW });
    expect(d.slept).toEqual([20_000, 20_000]);
  });

  it("keeps waiting while health reports a different commit from the live deploy", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": () => deploy("live", SHA_NEW),
      "app.example/api/health": (n) => (n < 4 ? health(SHA_OLD) : health(SHA_NEW)),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "k", APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_NEW });
    expect(d.slept).toHaveLength(3);
  });

  it("times out with a plain reason naming both commits when health never catches up", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": () => deploy("live", SHA_NEW),
      "app.example/api/health": () => health(SHA_OLD),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "secret-key-value", APP_URL: "https://app.example", DEMO_WAIT_MINUTES: "1", DEMO_POLL_SECONDS: "20" });
    const r = await waitForLiveVersion(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("de786d0");
    expect(r.reason).toContain("621270d");
    expect(r.reason).toContain("1 minute");
    expect(r.reason).not.toContain("secret-key-value");
  });

  it("accepts the health commit when the newest deploy failed (the old version is still serving)", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": () => deploy("build_failed", SHA_NEW),
      "app.example/api/health": () => health(SHA_OLD),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "k", APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_OLD });
  });

  it("accepts the health commit when the newest deploy was canceled", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": () => deploy("canceled", SHA_NEW),
      "app.example/api/health": () => health(SHA_OLD),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "k", APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_OLD });
  });

  it("without RENDER_API_KEY accepts the first ready health and never calls Render", async () => {
    const f = stubFetch({
      "app.example/api/health": (n) => (n === 1 ? new Response("starting", { status: 503 }) : health(SHA_OLD)),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "", APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_OLD });
    expect(f.urls.some((u) => u.includes("render.com"))).toBe(false);
    expect(d.slept).toEqual([20_000]);
  });

  it("is not ready when health says ok but carries no 40-hex commit", async () => {
    const f = stubFetch({
      "app.example/api/health": (n) => (n === 1 ? json({ ok: true, commit: "abc" }) : n === 2 ? json({ ok: false, commit: SHA_OLD }) : health(SHA_OLD)),
    });
    const d = deps(f.fn, { APP_URL: "https://app.example" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_OLD });
    expect(d.slept).toHaveLength(2);
  });

  it.each([
    ["a 503", () => new Response("down", { status: 503 }), /returned HTTP 503/],
    ["a timeout", () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })), /no answer within 30 s/],
    ["a refused connection", () => Promise.reject(new TypeError("fetch failed")), /could not connect/],
    ["a non-JSON answer", () => new Response("<html>hi</html>", { status: 200 }), /not JSON/],
  ])("times out with a plain reason when every health check is %s", async (_name, respond, reason) => {
    const f = stubFetch({ "app.example/api/health": respond as Route });
    const d = deps(f.fn, { APP_URL: "https://app.example", DEMO_WAIT_MINUTES: "1", DEMO_POLL_SECONDS: "20" });
    const r = await waitForLiveVersion(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/^The live app did not settle within 1 minute/);
    expect(r.reason).toMatch(reason);
    expect(f.calls["app.example/api/health"]).toBe(4); // t = 0, 20, 40, 60 s
  });

  it("bounds every request with a timeout signal", async () => {
    const signals: unknown[] = [];
    const fn = (async (_u: string | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return health(SHA_OLD);
    }) as typeof fetch;
    await waitForLiveVersion(deps(fn, { APP_URL: "https://app.example" }));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("uses the Render service URL when APP_URL is empty", async () => {
    const f = stubFetch({
      "/v1/services?": () => service.clone(),
      "/deploys": () => deploy("live", SHA_OLD),
      "svc.example/api/health": () => health(SHA_OLD),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "k", APP_URL: "" });
    expect(await waitForLiveVersion(d)).toEqual({ ok: true, version: SHA_OLD });
    expect(f.urls).toContain("https://svc.example/api/health");
  });

  it("finds the service by RENDER_SERVICE_NAME", async () => {
    const f = stubFetch({
      "/v1/services?name=other-svc": () => service.clone(),
      "/deploys": () => deploy("live", SHA_OLD),
      "svc.example/api/health": () => health(SHA_OLD),
    });
    expect(await waitForLiveVersion(deps(f.fn, { RENDER_API_KEY: "k", RENDER_SERVICE_NAME: "other-svc" }))).toEqual({ ok: true, version: SHA_OLD });
  });

  it("keeps polling through a failing Render API and says so on timeout, without the key", async () => {
    const f = stubFetch({
      "api.render.com": () => json({ message: "unauthorized" }, 401),
      "app.example/api/health": () => health(SHA_OLD),
    });
    const d = deps(f.fn, { RENDER_API_KEY: "secret-key-value", APP_URL: "https://app.example", DEMO_WAIT_MINUTES: "1" });
    const r = await waitForLiveVersion(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Render could not be reached \(HTTP 401\)/);
    expect(r.reason).not.toContain("secret-key-value");
  });

  it("times out plainly when no app URL is known at all", async () => {
    const f = stubFetch({});
    const r = await waitForLiveVersion(deps(f.fn, { DEMO_WAIT_MINUTES: "1" }));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/no app address/);
    expect(f.urls).toEqual([]);
  });
});

const RUN_ENV = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/dash", GITHUB_RUN_ID: "77" };
const VIDEO = "https://github.com/o/dash/releases/download/demos/demo-2026-11-17.mp4";
const NOW = new Date("2026-11-18T01:02:03Z");

function result(env: Record<string, string | undefined>, log?: string) {
  return buildDemoResult({
    env: { ...RUN_ENV, DEMO_LOG: "demo.log", ...env },
    readLog: async () => {
      if (log === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return log;
    },
    now: () => NOW,
  });
}
const allSuccess = { LIVE_OUTCOME: "success", DEMO_OUTCOME: "success", UPLOAD_OUTCOME: "success", DEMO_VERSION: SHA_OLD, DEMO_VIDEO_URL: VIDEO };

describe("buildDemoResult (D-6, P-1)", () => {
  it("records a full success", async () => {
    expect(await result(allSuccess, "all good\n")).toEqual<Demo>({
      outcome: "success",
      recordedAt: "2026-11-18T01:02:03.000Z",
      version: SHA_OLD,
      versionUrl: `https://github.com/daveharmswebdev/chess-tutor/commit/${SHA_OLD}`,
      step: null,
      videoUrl: VIDEO,
      run: { label: "Run 77", url: "https://github.com/o/dash/actions/runs/77" },
    });
  });

  it("uses TARGET_REPO for the version link", async () => {
    expect((await result({ ...allSuccess, TARGET_REPO: "x/y" })).versionUrl).toBe(`https://github.com/x/y/commit/${SHA_OLD}`);
  });

  it("fails when the wait failed (nothing else ran)", async () => {
    const d = await result({ LIVE_OUTCOME: "failure", DEMO_OUTCOME: "", UPLOAD_OUTCOME: "", DEMO_VERSION: "", DEMO_VIDEO_URL: "" });
    expect(d).toMatchObject({ outcome: "failure", version: null, versionUrl: null, step: null, videoUrl: null });
  });

  it("fails with chess-tutor's step when the demo failed, and keeps the partial video", async () => {
    const d = await result({ ...allSuccess, DEMO_OUTCOME: "failure" }, "x\nError: demo stopped at Hint: the hint arrow never appeared\n");
    expect(d).toMatchObject({ outcome: "failure", step: "Hint", videoUrl: VIDEO, version: SHA_OLD });
  });

  it("fails when the upload failed, with no step and no video", async () => {
    const d = await result({ ...allSuccess, UPLOAD_OUTCOME: "failure" }, "demo stopped at Hint: x");
    expect(d).toMatchObject({ outcome: "failure", step: null, videoUrl: null });
  });

  it("fails when the upload was skipped (no video file)", async () => {
    const d = await result({ ...allSuccess, UPLOAD_OUTCOME: "", DEMO_VIDEO_URL: "" });
    expect(d).toMatchObject({ outcome: "failure", videoUrl: null });
  });

  it("fails when everything succeeded but no video URL came back", async () => {
    expect((await result({ ...allSuccess, DEMO_VIDEO_URL: "" })).outcome).toBe("failure");
  });

  it.each(["cancelled", "skipped"])("fails when the demo step was %s, with no step", async (o) => {
    expect(await result({ ...allSuccess, DEMO_OUTCOME: o }, "demo stopped at Hint: x")).toMatchObject({ outcome: "failure", step: null });
  });

  it.each(["the tutor's question", "Hint", "Show me"])("takes the step %j word for word", async (step) => {
    const d = await result({ ...allSuccess, DEMO_OUTCOME: "failure" }, `  1) demo.spec.ts\n    Error: demo stopped at ${step}: expected text: "a: b"\n`);
    expect(d.step).toBe(step);
  });

  it("strips ANSI colour codes around the step", async () => {
    const log = "\u001b[31m  Error: \u001b[39m\u001b[1mdemo stopped at \u001b[22mthe tutor's question\u001b[2m: \u001b[22mno reply within 10 s\u001b[0m\n";
    expect((await result({ ...allSuccess, DEMO_OUTCOME: "failure" }, log)).step).toBe("the tutor's question");
  });

  it("takes the first step line when the log repeats it", async () => {
    const log = "demo stopped at Show me: a\n... retry ...\ndemo stopped at Hint: b\n";
    expect((await result({ ...allSuccess, DEMO_OUTCOME: "failure" }, log)).step).toBe("Show me");
  });

  it("has no step when the failure names none", async () => {
    const log = "Error: no scripted or fallback move is legal after e4 e5\nTimeoutError: expect(locator).toBeVisible() timed out\n";
    expect(await result({ ...allSuccess, DEMO_OUTCOME: "failure" }, log)).toMatchObject({ outcome: "failure", step: null });
  });

  it("has no step when the log file is missing", async () => {
    expect(await result({ ...allSuccess, DEMO_OUTCOME: "failure" }, undefined)).toMatchObject({ outcome: "failure", step: null });
  });

  it("has no step when DEMO_LOG is unset", async () => {
    const d = await buildDemoResult({ env: { ...RUN_ENV, ...allSuccess, DEMO_OUTCOME: "failure" }, readLog: async () => "demo stopped at Hint: x", now: () => NOW });
    expect(d.step).toBeNull();
  });

  it.each(["", "abc123", SHA_OLD.toUpperCase(), `${SHA_OLD}0`, `version=${SHA_OLD}`])("treats version %j as unconfirmed", async (v) => {
    expect(await result({ ...allSuccess, DEMO_VERSION: v })).toMatchObject({ version: null, versionUrl: null });
  });

  it("throws when the run env is missing", async () => {
    await expect(buildDemoResult({ env: { ...allSuccess }, readLog: async () => "", now: () => NOW })).rejects.toThrow(/GITHUB_RUN_ID/);
  });

  it("produces a result parseDemo accepts", async () => {
    const d = await result(allSuccess);
    expect(parseDemo(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});

const sample: Demo = {
  outcome: "failure",
  recordedAt: "2026-11-18T01:02:03.000Z",
  version: SHA_OLD,
  versionUrl: `https://github.com/o/r/commit/${SHA_OLD}`,
  step: "Hint",
  videoUrl: VIDEO,
  run: { label: "Run 77", url: "https://github.com/o/dash/actions/runs/77" },
};

describe("loadSnapshotDemo (D-6, P-5)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "demo-test-"));
    await mkdir(join(dir, "snapshots"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const snapshotsDir = () => join(dir, "snapshots");
  const writeSnap = (date: string, demo: unknown) => writeFile(join(snapshotsDir(), `${date}.json`), JSON.stringify({ schemaVersion: 1, date, demo }));

  it("takes the demo from DEMO_RESULT_FILE", async () => {
    const file = join(dir, "demo-result.json");
    await writeFile(file, JSON.stringify(sample));
    await writeSnap("2026-11-17", { ...sample, step: "Show me" });
    expect(await loadSnapshotDemo({ resultFile: file, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toEqual(sample);
  });

  it.each([
    ["not JSON", "{not json"],
    ["a bad outcome", JSON.stringify({ ...sample, outcome: "maybe" })],
    ["a missing run", JSON.stringify({ ...sample, run: undefined })],
    ["a short version", JSON.stringify({ ...sample, version: "abc" })],
    ["a non-string step", JSON.stringify({ ...sample, step: 3 })],
    ["a bad recordedAt", JSON.stringify({ ...sample, recordedAt: "yesterday" })],
    ["null", "null"],
  ])("throws on a DEMO_RESULT_FILE with %s", async (_n, body) => {
    const file = join(dir, "demo-result.json");
    await writeFile(file, body);
    await expect(loadSnapshotDemo({ resultFile: file, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).rejects.toThrow(/demo result/i);
  });

  it("throws when DEMO_RESULT_FILE names a missing file", async () => {
    await expect(loadSnapshotDemo({ resultFile: join(dir, "nope.json"), snapshotsDir: snapshotsDir(), date: "2026-11-17" })).rejects.toThrow(/demo result/i);
  });

  it("carries the demo over from the same date's snapshot", async () => {
    await writeSnap("2026-11-17", sample);
    expect(await loadSnapshotDemo({ resultFile: "", snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toEqual(sample);
  });

  it("is null when there is no result file and no snapshot for the date", async () => {
    expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toBeNull();
  });

  it("is null when today's snapshot has no demo yet", async () => {
    await writeSnap("2026-11-17", null);
    expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toBeNull();
    await writeFile(join(snapshotsDir(), "2026-11-17.json"), JSON.stringify({ schemaVersion: 1, date: "2026-11-17" }));
    expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toBeNull();
  });

  it("never carries over an older day's demo", async () => {
    await writeSnap("2026-11-16", sample);
    expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toBeNull();
  });

  it("ignores a same-named file whose date field is another day", async () => {
    await writeFile(join(snapshotsDir(), "2026-11-17.json"), JSON.stringify({ schemaVersion: 1, date: "2026-11-16", demo: sample }));
    expect(await loadSnapshotDemo({ resultFile: undefined, snapshotsDir: snapshotsDir(), date: "2026-11-17" })).toBeNull();
  });
});
