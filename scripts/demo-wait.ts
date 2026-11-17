/**
 * Demo workflow step (#6, D-6): waits for the live chess-tutor app to settle on its newest version,
 * then appends `version=<sha>` to $GITHUB_OUTPUT. On timeout prints what it last saw and exits 1.
 */
import { appendFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { waitForLiveVersion } from "../src/fetch/demo.ts";

const result = await waitForLiveVersion({ env: process.env, fetch, now: () => Date.now(), sleep: async (ms) => void (await sleep(ms)) });

if (result.ok) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\n`);
  console.log(`The live app is on ${result.version}`);
} else {
  console.log(result.reason);
  process.exitCode = 1;
}
