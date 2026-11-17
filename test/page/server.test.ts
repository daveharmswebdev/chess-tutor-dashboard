/**
 * The dashboard stays behind its password (O-2, P-6), and ?date= never builds a path (#5).
 * Uses Fastify's inject(): no real port, no network.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, startupRefusal } from "../../src/server.ts";

const PASSWORD = "test-only-password";
const fixture = readFileSync(new URL("../fixtures/snapshot.json", import.meta.url), "utf8");
const basic = (pass: string) => `Basic ${Buffer.from(`client:${pass}`).toString("base64")}`;

const dirs: string[] = [];
function snapshotsDir(dates: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-snapshots-"));
  dirs.push(dir);
  for (const date of dates) writeFileSync(join(dir, `${date}.json`), JSON.stringify({ ...JSON.parse(fixture), date }));
  return dir;
}
/** Like snapshotsDir, but some dates get a raw (damaged) file body instead of the fixture. */
function damagedDir(good: string[], damaged: Record<string, string>): string {
  const dir = snapshotsDir(good);
  for (const [date, body] of Object.entries(damaged)) writeFileSync(join(dir, `${date}.json`), body);
  return dir;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const protectedPaths = ["/", "/?date=2026-11-15", "/style.css", "/tokens.css", "/logo.svg"];

describe("server with a password (O-2, P-6)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ password: PASSWORD, snapshotsDir: snapshotsDir(["2026-11-15", "2026-11-16"]) });
  });
  afterAll(() => app.close());

  for (const url of protectedPaths) {
    it(`${url} is 401 without the password`, async () => {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(401);
      expect(res.headers["www-authenticate"]).toContain("Basic");
      expect(res.body).not.toContain("<html");
    });
    it(`${url} is 401 with a wrong password`, async () => {
      const res = await app.inject({ url, headers: { authorization: basic("wrong-password") } });
      expect(res.statusCode).toBe(401);
    });
    it(`${url} is 200 with the password`, async () => {
      const res = await app.inject({ url, headers: { authorization: basic(PASSWORD) } });
      expect(res.statusCode).toBe(200);
    });
  }

  it("a password of a different length is refused", async () => {
    const res = await app.inject({ url: "/", headers: { authorization: basic(`${PASSWORD}x`) } });
    expect(res.statusCode).toBe(401);
  });

  it("/healthz is 200 without the password", async () => {
    const res = await app.inject({ url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("serves assets with their content types", async () => {
    const auth = { authorization: basic(PASSWORD) };
    expect((await app.inject({ url: "/style.css", headers: auth })).headers["content-type"]).toContain("text/css");
    expect((await app.inject({ url: "/tokens.css", headers: auth })).headers["content-type"]).toContain("text/css");
    expect((await app.inject({ url: "/logo.svg", headers: auth })).headers["content-type"]).toContain("image/svg+xml");
  });

  it("/ shows the newest snapshot", async () => {
    const res = await app.inject({ url: "/", headers: { authorization: basic(PASSWORD) } });
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain(`<span class="hist-current">2026-11-16</span>`);
  });

  it("a known ?date= shows that day", async () => {
    const res = await app.inject({ url: "/?date=2026-11-15", headers: { authorization: basic(PASSWORD) } });
    expect(res.body).toContain(`<span class="hist-current">2026-11-15</span>`);
    expect(res.body).toContain("You're looking at 2026-11-15");
  });

  for (const date of ["2099-01-01", "../package", "..%2F..%2Fpackage", "2026-11-16.json", "/etc/passwd"]) {
    it(`an unknown ?date=${date} falls back to the newest snapshot`, async () => {
      const res = await app.inject({ url: `/?date=${date}`, headers: { authorization: basic(PASSWORD) } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(`<span class="hist-current">2026-11-16</span>`);
      expect(res.body).not.toContain("chess-tutor-dashboard\",\n  \"private\""); // package.json was not read
    });
  }

  it("unknown routes are still behind the password", async () => {
    const res = await app.inject({ url: "/snapshots/2026-11-16.json" });
    expect(res.statusCode).toBe(401);
  });
});

describe("server with no snapshots (P-2)", () => {
  it("returns 503 with a plain-words reason", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: snapshotsDir([]) });
    const res = await app.inject({ url: "/", headers: { authorization: basic(PASSWORD) } });
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("No snapshot yet");
    await app.close();
  });

  it("returns 503 when the snapshots dir does not exist", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: join(tmpdir(), "dashboard-no-such-dir-xyz") });
    const res = await app.inject({ url: "/", headers: { authorization: basic(PASSWORD) } });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe("server with a damaged snapshot (#10, P-2, P-7, P-4)", () => {
  const TRUNCATED = `{"schemaVersion":1,"da`;
  const dashRepo = process.env.DASHBOARD_REPO ?? "daveharmswebdev/chess-tutor-dashboard";
  const auth = { authorization: basic(PASSWORD) };
  const notice = (failed: string, shown: string) =>
    `<p class="old">The status saved for ${failed} could not be opened, so this shows ${shown}, the most recent healthy file. ` +
    `<a href="https://github.com/${dashRepo}/blob/main/snapshots/${failed}.json" target="_blank" rel="noopener">damaged file</a></p>`;
  const noLeak = (body: string) => {
    expect(body).not.toContain("Internal Server Error");
    expect(body).not.toContain("Unexpected end");
    expect(body).not.toContain("SyntaxError");
  };

  it("a truncated newest file falls back to the newest readable older day, with a notice", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: damagedDir(["2026-11-14", "2026-11-15"], { "2026-11-16": TRUNCATED }) });
    const res = await app.inject({ url: "/", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain(notice("2026-11-16", "2026-11-15"));
    expect(res.body).toContain(`<span class="hist-current">2026-11-15</span>`);
    expect(res.body).not.toContain("You're looking at");
    expect(res.body).not.toContain(`<a href="/">See today</a>`);
    // The history footer still lists every date, the damaged one included.
    expect(res.body).toContain(`<a href="/?date=2026-11-16">2026-11-16</a>`);
    expect(res.body).toContain(`<a href="/?date=2026-11-14">2026-11-14</a>`);
    expect(res.body).toContain("What went");
    noLeak(res.body);
    await app.close();
  });

  it("?date= pointing at a damaged older day falls back to the next older readable day", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: damagedDir(["2026-11-13", "2026-11-16"], { "2026-11-15": TRUNCATED, "2026-11-14": "" }) });
    const res = await app.inject({ url: "/?date=2026-11-15", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(notice("2026-11-15", "2026-11-13"));
    expect(res.body).toContain(`<span class="hist-current">2026-11-13</span>`);
    noLeak(res.body);
    // The newest, readable day is unaffected.
    const newest = await app.inject({ url: "/", headers: auth });
    expect(newest.body).toContain(`<span class="hist-current">2026-11-16</span>`);
    expect(newest.body).not.toContain("could not be opened");
    await app.close();
  });

  for (const [name, body] of [["{}", "{}"], ["null", "null"], ["an array", "[]"], ["a string", `"x"`]] as const) {
    it(`valid JSON missing required fields (${name}) counts as damaged`, async () => {
      const app = await buildApp({ password: PASSWORD, snapshotsDir: damagedDir(["2026-11-15"], { "2026-11-16": body }) });
      const res = await app.inject({ url: "/", headers: auth });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(notice("2026-11-16", "2026-11-15"));
      noLeak(res.body);
      await app.close();
    });
  }

  it("every file damaged gives a 503 with a plain-words reason", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: damagedDir([], { "2026-11-16": TRUNCATED, "2026-11-15": "{}" }) });
    const res = await app.inject({ url: "/", headers: auth });
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("The status saved for 2026-11-16 could not be opened, and no earlier day could be opened either.");
    noLeak(res.body);
    await app.close();
  });

  it("a damaged ?date= with only newer readable days gives 503 naming that date", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: damagedDir(["2026-11-16"], { "2026-11-15": TRUNCATED }) });
    const res = await app.inject({ url: "/?date=2026-11-15", headers: auth });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe("The status saved for 2026-11-15 could not be opened, and no earlier day could be opened either.");
    await app.close();
  });

  it("the fallback page is still behind the password", async () => {
    const app = await buildApp({ password: PASSWORD, snapshotsDir: damagedDir(["2026-11-15"], { "2026-11-16": TRUNCATED }) });
    const res = await app.inject({ url: "/" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("could not be opened");
    await app.close();
  });
});

describe("server stale warning (#3, P-2, P-7)", () => {
  // Fixture generatedAt is 2026-11-16T21:53:18.953Z; the clock is fixed through AppOptions.now.
  const generated = Date.parse("2026-11-16T21:53:18.953Z");
  const H = 3600 * 1000;
  const auth = { authorization: basic(PASSWORD) };
  const SENTENCE = "This page hasn&#39;t updated since Monday 3:53 PM. We&#39;re looking into it.";
  const appAt = (ms: number, dir: string) => buildApp({ password: PASSWORD, snapshotsDir: dir, now: () => new Date(generated + ms) });

  it("/ with a snapshot older than 26h shows the warning", async () => {
    const app = await appAt(26 * H + 60_000, snapshotsDir(["2026-11-16"]));
    const res = await app.inject({ url: "/", headers: auth });
    expect(res.body).toContain(SENTENCE);
    await app.close();
  });

  it("/ with a fresh snapshot shows no warning", async () => {
    const app = await appAt(2 * H, snapshotsDir(["2026-11-16"]));
    const res = await app.inject({ url: "/", headers: auth });
    expect(res.body).not.toContain('class="stale"');
    await app.close();
  });

  it("/?date= of an older day is never stale", async () => {
    const app = await appAt(30 * 24 * H, snapshotsDir(["2026-11-15", "2026-11-16"]));
    const res = await app.inject({ url: "/?date=2026-11-15", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<span class="hist-current">2026-11-15</span>`);
    expect(res.body).not.toContain('class="stale"');
    await app.close();
  });

  it("/?date=<newest day> (the history link back) is the default view and shows the warning", async () => {
    const app = await appAt(30 * H, snapshotsDir(["2026-11-15", "2026-11-16"]));
    const res = await app.inject({ url: "/?date=2026-11-16", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<span class="hist-current">2026-11-16</span>`);
    expect(res.body).toContain(SENTENCE);
    await app.close();
  });

  it("a newest file whose generatedAt is not a timestamp counts as damaged and falls back with the notice", async () => {
    const dir = snapshotsDir(["2026-11-15"]);
    writeFileSync(join(dir, "2026-11-16.json"), JSON.stringify({ ...JSON.parse(fixture), date: "2026-11-16", generatedAt: "not a date" }));
    const app = await appAt(2 * H, dir);
    const res = await app.inject({ url: "/", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("The status saved for 2026-11-16 could not be opened, so this shows 2026-11-15, the most recent healthy file.");
    expect(res.body).toContain(`<span class="hist-current">2026-11-15</span>`);
    await app.close();
  });

  it("an unknown ?date= falls back to the newest day, which can be stale", async () => {
    const app = await appAt(27 * H, snapshotsDir(["2026-11-16"]));
    const res = await app.inject({ url: "/?date=2099-01-01", headers: auth });
    expect(res.body).toContain(SENTENCE);
    await app.close();
  });

  it("the damaged-file fallback with no date requested shows the notice and the warning", async () => {
    const app = await appAt(27 * H, damagedDir(["2026-11-15"], { "2026-11-16": `{"schemaVersion":1,"da` }));
    const res = await app.inject({ url: "/", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("The status saved for 2026-11-16 could not be opened");
    expect(res.body).toContain(SENTENCE);
    await app.close();
  });

  it("the damaged-file fallback for a requested ?date= shows no warning", async () => {
    const app = await appAt(27 * H, damagedDir(["2026-11-14", "2026-11-16"], { "2026-11-15": `{"schemaVersion":1,"da` }));
    const res = await app.inject({ url: "/?date=2026-11-15", headers: auth });
    expect(res.body).toContain("The status saved for 2026-11-15 could not be opened");
    expect(res.body).not.toContain('class="stale"');
    await app.close();
  });
});

describe("server with no password (local dev)", () => {
  it("serves openly", async () => {
    const app = await buildApp({ password: undefined, snapshotsDir: snapshotsDir(["2026-11-16"]) });
    expect((await app.inject({ url: "/" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/style.css" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    await app.close();
  });

  it("treats an empty password as no password, not as a password of ''", async () => {
    const app = await buildApp({ password: "", snapshotsDir: snapshotsDir(["2026-11-16"]) });
    expect((await app.inject({ url: "/" })).statusCode).toBe(200);
    await app.close();
  });
});

describe("startupRefusal: fail closed on Render or production (O-2, P-6)", () => {
  it("refuses on Render without a password", () => {
    expect(startupRefusal({ RENDER: "true" })).toMatch(/DASHBOARD_PASSWORD/);
  });
  it("refuses with NODE_ENV=production without a password", () => {
    expect(startupRefusal({ NODE_ENV: "production" })).toMatch(/DASHBOARD_PASSWORD/);
  });
  it("refuses on Render with an empty password", () => {
    expect(startupRefusal({ RENDER: "true", DASHBOARD_PASSWORD: "" })).toMatch(/DASHBOARD_PASSWORD/);
  });
  it("allows Render with a password", () => {
    expect(startupRefusal({ RENDER: "true", NODE_ENV: "production", DASHBOARD_PASSWORD: "x" })).toBeNull();
  });
  it("allows local dev without a password", () => {
    expect(startupRefusal({})).toBeNull();
    expect(startupRefusal({ NODE_ENV: "development" })).toBeNull();
  });
});
