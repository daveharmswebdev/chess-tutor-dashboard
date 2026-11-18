/**
 * Demo workflow step (#6, D-6): builds one Demo (src/types.ts) from the workflow's step outcomes
 * and writes it to the file named by the first argument. Usage: demo-result.ts <out.json>
 */
import { readFile, writeFile } from "node:fs/promises";
import { buildDemoResult } from "../src/fetch/demo.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: demo-result.ts <out.json>");

const demo = await buildDemoResult({ env: process.env, readLog: (path) => readFile(path, "utf8"), now: () => new Date() });
await writeFile(out, JSON.stringify(demo, null, 2) + "\n");
console.log(`Wrote ${out}: demo ${demo.outcome}${demo.step ? ` (stopped at ${demo.step})` : ""}, video ${demo.videoUrl ? "saved" : "none"}${demo.planned ? `, planned ${demo.planned.at}${demo.planned.late ? " (late)" : ""}` : ""}`);
