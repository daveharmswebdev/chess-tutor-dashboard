// Refuses a glossary file the snapshot build would reject (#21, P-2), using the build's own rules:
// the same readFile + JSON.parse as scripts/snapshot.ts and labelledRequirements from progress.ts,
// so the mirror and the build can't drift apart. Also refuses an empty list (it would empty the page).
// Usage: node --experimental-strip-types validate-glossary.ts <file>. Exit 1 with the reason.
import { readFile } from "node:fs/promises";
import { labelledRequirements, type Glossary } from "../../src/fetch/progress.ts";

const file = process.argv[2];
try {
  if (!file) throw new Error("no file given");
  const glossary = JSON.parse(await readFile(file, "utf8")) as Glossary;
  if (labelledRequirements(glossary).length === 0) throw new Error("glossary.json: no labelled requirements");
  console.log(`Valid: ${labelledRequirements(glossary).length} labelled requirements.`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
