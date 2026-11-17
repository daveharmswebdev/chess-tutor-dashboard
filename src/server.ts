/**
 * Serves the dashboard: the latest (or ?date=) snapshot rendered as HTML, behind one shared password.
 * Holds no API keys; all fetching happens in the GitHub Action.
 *
 * `buildApp()` returns a ready (not listening) app so tests can use inject(); the server only
 * listens when this file is run directly (`pnpm start`, `pnpm dev`).
 */
import { readdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import basicAuth from "@fastify/basic-auth";
import { demoVideoSource, renderPage } from "./page.ts";
import type { Snapshot } from "./types.ts";

export interface AppOptions {
  /** The shared password. Unset or empty serves without a password (local dev only). */
  password: string | undefined;
  /** Directory holding YYYY-MM-DD.json snapshots. */
  snapshotsDir: string;
  /** Repo root; static assets are read from `<root>/public`. Defaults to this repo. */
  root?: string;
  /** true, false, or pino options (tests pass a stream to read the log). */
  logger?: boolean | { level?: string; stream: { write(msg: string): void } };
  /** The clock used to decide whether the default view is stale (#3). Tests fix it. */
  now?: () => Date;
  /** Fetches the demo video from GitHub for /demo/:file (#18). Tests stub it. */
  fetch?: typeof globalThis.fetch;
  /** How long /demo waits for GitHub's response headers, in ms. The body itself has no limit. */
  demoHeaderTimeoutMs?: number;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** What may be logged about an upstream failure: the error's name and code, never its message (P-6). */
function errorFacts(err: unknown): { error: string; code?: string; cause?: string } {
  if (!(err instanceof Error)) return { error: typeof err };
  const code = (err as { code?: unknown }).code;
  const cause = err.cause instanceof Error ? ((err.cause as { code?: unknown }).code ?? err.cause.name) : undefined;
  return {
    error: err.name,
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof cause === "string" ? { cause } : {}),
  };
}

const badGateway = (reply: FastifyReply) =>
  reply.type("text/plain").code(502).header("Cache-Control", "no-store").send("The demo video could not be loaded from GitHub.");

/**
 * Fail closed (O-2, P-6): on Render or in production a missing password must stop the server
 * rather than expose the page. Returns the reason to refuse, or null when it is fine to start.
 */
export function startupRefusal(env: Record<string, string | undefined>): string | null {
  if (env.DASHBOARD_PASSWORD) return null;
  if (env.RENDER || env.NODE_ENV === "production") {
    return "Refusing to start: DASHBOARD_PASSWORD is not set, and this is Render or production. Set it in the Render dashboard.";
  }
  return null;
}

export async function buildApp({ password, snapshotsDir, root = repoRoot, logger = false, now = () => new Date(), fetch = globalThis.fetch, demoHeaderTimeoutMs = 15_000 }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  await app.register(basicAuth, {
    authenticate: { realm: "Chess Tutor status" },
    validate: async (_user, pass) => {
      if (!password || !same(pass, password)) throw new Error("Wrong password");
    },
  });
  if (password) {
    app.addHook("onRequest", (req, reply, done) => (req.url === "/healthz" ? done() : app.basicAuth(req, reply, done)));
  } else {
    app.log.warn("DASHBOARD_PASSWORD is not set: serving WITHOUT a password (local dev only)");
  }

  async function snapshotDates(): Promise<string[]> {
    const files = await readdir(snapshotsDir).catch(() => [] as string[]);
    return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse();
  }

  app.get("/healthz", async () => ({ ok: true }));

  // Static assets, loaded once at startup (a fixed list, so no path handling).
  const assets: Record<string, string> = { "/tokens.css": "text/css", "/style.css": "text/css", "/logo.svg": "image/svg+xml" };
  for (const [path, type] of Object.entries(assets)) {
    const body = await readFile(join(root, "public", path));
    app.get(path, async (_req, reply) => reply.type(type).header("Cache-Control", "max-age=300").send(body));
  }

  app.get<{ Querystring: { date?: string } }>("/", async (req, reply) => {
    const dates = await snapshotDates();
    // Only a date found in the directory listing is ever used to build a path.
    const date = req.query.date && dates.includes(req.query.date) ? req.query.date : dates[0];
    if (!date) return reply.type("text/plain").code(503).send("No snapshot yet. Run `pnpm snapshot`.");
    // An older day named on purpose is history, never stale (#3). ?date=<newest> is the default view.
    const requestedDate = date !== dates[0];
    const renderOpts = { now: now(), requestedDate };

    // Read, parse and render one day; a file that cannot be read, parsed or rendered counts as damaged (#10).
    const tryRender = async (d: string, notice?: { failedDate: string }): Promise<string | null> => {
      try {
        const snap = JSON.parse(await readFile(join(snapshotsDir, `${d}.json`), "utf8")) as Snapshot;
        return renderPage(snap, dates, d === dates[0], notice, renderOpts);
      } catch (err) {
        app.log.error({ err, date: d }, "snapshot could not be opened");
        return null;
      }
    };
    const html = (body: string) => reply.type("text/html").header("Cache-Control", "no-store").send(body);

    const page = await tryRender(date);
    if (page !== null) return html(page);
    // Walk the older days in the listing, newest first, and show the first that renders.
    for (const older of dates.slice(dates.indexOf(date) + 1)) {
      const fallback = await tryRender(older, { failedDate: date });
      if (fallback !== null) return html(fallback);
    }
    return reply
      .type("text/plain")
      .code(503)
      .header("Cache-Control", "no-store")
      .send(`The status saved for ${date} could not be opened, and no earlier day could be opened either.`);
  });

  // The day's demo video, served with headers iOS will play (#18, D-6). GitHub sends the release
  // asset as an octet-stream attachment, which iOS WebKit refuses. Only the snapshot's own https
  // github.com videoUrl is ever fetched, for a date found in the directory listing (P-6).
  const demoFile = /^(\d{4}-\d{2}-\d{2})\.mp4$/;
  const passHeaders = ["content-length", "content-range", "accept-ranges", "last-modified", "etag"];
  const notFound = (reply: FastifyReply) => reply.type("text/plain").code(404).header("Cache-Control", "no-store").send("Not found.");
  // GET and HEAD registered together so Fastify's automatic HEAD route doesn't reset Content-Length.
  app.route<{ Params: { file: string } }>({ method: ["GET", "HEAD"], url: "/demo/:file", handler: async (req, reply) => {
    const date = demoFile.exec(req.params.file)?.[1];
    const dates = await snapshotDates();
    if (!date || !dates.includes(date)) return notFound(reply);
    let videoUrl: string | null | undefined;
    try {
      const snap = JSON.parse(await readFile(join(snapshotsDir, `${date}.json`), "utf8")) as Snapshot;
      videoUrl = snap.demo?.videoUrl;
    } catch (err) {
      app.log.error({ err, date }, "snapshot could not be opened for its demo video");
      return notFound(reply);
    }
    if (!videoUrl || !demoVideoSource(videoUrl)) return notFound(reply);

    // The time limit covers only the wait for GitHub's response headers. Once they arrive the timer
    // is cleared, so a slow client can take as long as it needs to download the body.
    let upstream: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("No response headers from GitHub in time", "TimeoutError")), demoHeaderTimeoutMs);
    try {
      const range = req.headers.range;
      upstream = await fetch(videoUrl, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        redirect: "follow",
        headers: range ? { range } : {},
        signal: controller.signal,
      });
    } catch (err) {
      // Never the message: it can carry the signed redirect URL (P-6).
      app.log.error({ date, ...errorFacts(err) }, "demo video fetch failed");
      return badGateway(reply);
    } finally {
      clearTimeout(timer);
    }
    if (![200, 206, 416].includes(upstream.status)) {
      await upstream.body?.cancel().catch(() => {});
      app.log.error({ date, status: upstream.status }, "demo video fetch returned an unexpected status");
      return badGateway(reply);
    }
    reply.code(upstream.status).header("Content-Type", "video/mp4").header("Cache-Control", "private, max-age=300");
    for (const h of passHeaders) {
      const v = upstream.headers.get(h);
      if (v !== null) reply.header(h, v);
    }
    if (!upstream.headers.has("accept-ranges")) reply.header("Accept-Ranges", "bytes");
    if (!upstream.body || req.method === "HEAD") {
      await upstream.body?.cancel().catch(() => {});
      return reply.send();
    }
    // Stream through a PassThrough so an upstream error is logged without its message (it can carry
    // the signed URL, P-6) and ends only this response. A client that leaves closes `out`, which
    // destroys `source` and cancels the upstream body.
    const source = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
    const out = new PassThrough();
    source.on("error", (err) => {
      app.log.warn({ date, ...errorFacts(err) }, "demo video stream from GitHub broke off");
      out.destroy(new Error("The demo video stream from GitHub broke off."));
    });
    out.on("close", () => source.destroy());
    source.pipe(out);
    return reply.send(out);
  } });

  await app.ready();
  return app;
}

/** True when this module is the entry point (`tsx src/server.ts`), not imported by a test. */
function isEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  const refusal = startupRefusal(process.env);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const app = await buildApp({ password: process.env.DASHBOARD_PASSWORD, snapshotsDir: join(repoRoot, "snapshots"), logger: true });
  await app.listen({ port: Number(process.env.PORT ?? 3100), host: process.env.HOST ?? "0.0.0.0" });
}
