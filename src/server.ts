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
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import basicAuth from "@fastify/basic-auth";
import { renderPage } from "./page.ts";
import type { Snapshot } from "./types.ts";

export interface AppOptions {
  /** The shared password. Unset or empty serves without a password (local dev only). */
  password: string | undefined;
  /** Directory holding YYYY-MM-DD.json snapshots. */
  snapshotsDir: string;
  /** Repo root; static assets are read from `<root>/public`. Defaults to this repo. */
  root?: string;
  logger?: boolean;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

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

export async function buildApp({ password, snapshotsDir, root = repoRoot, logger = false }: AppOptions): Promise<FastifyInstance> {
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

    // Read, parse and render one day; a file that cannot be read, parsed or rendered counts as damaged (#10).
    const tryRender = async (d: string, notice?: { failedDate: string }): Promise<string | null> => {
      try {
        const snap = JSON.parse(await readFile(join(snapshotsDir, `${d}.json`), "utf8")) as Snapshot;
        return renderPage(snap, dates, d === dates[0], notice);
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
      .send(`The saved status for ${date} could not be opened, and no earlier day could be opened either.`);
  });

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
