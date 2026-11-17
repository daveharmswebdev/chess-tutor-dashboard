/**
 * Builds today's snapshot from GitHub and Render and writes snapshots/YYYY-MM-DD.json.
 * Runs in the GitHub Action; also runs locally with `pnpm snapshot` (uses your gh login).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSnapshotDemo } from "../src/fetch/demo.ts";
import { buildDigest, fetchBoard, fetchMergedPrs } from "../src/fetch/digest.ts";
import { buildProgress, type Glossary } from "../src/fetch/progress.ts";
import { fetchStatus } from "../src/fetch/status.ts";
import type { Snapshot } from "../src/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = process.env.TARGET_REPO ?? "daveharmswebdev/chess-tutor";
const owner = repo.split("/")[0]!;
const projectNumber = Number(process.env.PROJECT_NUMBER ?? 5);
const timezone = process.env.DASHBOARD_TZ ?? "America/Chicago";

const now = new Date();
const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const glossary = JSON.parse(await readFile(`${root}glossary.json`, "utf8")) as Glossary;
// The evening demo (#6): from the Demo workflow's result file, else kept from today's earlier snapshot.
const demo = await loadSnapshotDemo({ resultFile: process.env.DEMO_RESULT_FILE, snapshotsDir: `${root}snapshots`, date });
const [merged, board, status] = await Promise.all([fetchMergedPrs(repo), fetchBoard(repo, owner, projectNumber), fetchStatus(repo)]);

const run =
  process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? { label: `Run ${process.env.GITHUB_RUN_ID}`, url: `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` }
    : null;

const snapshot: Snapshot = {
  schemaVersion: 1,
  date,
  generatedAt: now.toISOString(),
  timezone,
  run,
  repo,
  status,
  digest: buildDigest(merged, board, now),
  progress: buildProgress(glossary, merged, board.issues),
  demo,
};

await mkdir(`${root}snapshots`, { recursive: true });
const out = `${root}snapshots/${date}.json`;
await writeFile(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(
  `Wrote ${out}: ${snapshot.digest.shippedToday.length} shipped today, ${snapshot.progress.shipped}/${snapshot.progress.total} requirements shipped, ` +
    `health ${status.health ? (status.health.ok ? "up" : "DOWN") : "unchecked"}, deploy ${status.deploy?.status ?? status.deployUnavailable}`,
);
