/**
 * Serves the dashboard: the latest (or ?date=) snapshot rendered as HTML, behind one shared password.
 * Holds no API keys; all fetching happens in the GitHub Action.
 */
import { readdir, readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import { renderPage } from "./page.ts";
import type { Snapshot } from "./types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const password = process.env.DASHBOARD_PASSWORD;
const app = Fastify({ logger: true });

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

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
  const files = await readdir(`${root}snapshots`).catch(() => []);
  return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse();
}

app.get("/healthz", async () => ({ ok: true }));

// Static assets, loaded once at startup (a fixed list, so no path handling).
const assets: Record<string, string> = { "/tokens.css": "text/css", "/style.css": "text/css", "/logo.svg": "image/svg+xml" };
for (const [path, type] of Object.entries(assets)) {
  const body = await readFile(`${root}public${path}`);
  app.get(path, async (_req, reply) => reply.type(type).header("Cache-Control", "max-age=300").send(body));
}

app.get<{ Querystring: { date?: string } }>("/", async (req, reply) => {
  const dates = await snapshotDates();
  const date = req.query.date && dates.includes(req.query.date) ? req.query.date : dates[0];
  if (!date) return reply.type("text/plain").code(503).send("No snapshot yet. Run `pnpm snapshot`.");
  const snap = JSON.parse(await readFile(`${root}snapshots/${date}.json`, "utf8")) as Snapshot;
  return reply.type("text/html").header("Cache-Control", "no-store").send(renderPage(snap, dates, date === dates[0]));
});

await app.listen({ port: Number(process.env.PORT ?? 3100), host: process.env.HOST ?? "0.0.0.0" });
