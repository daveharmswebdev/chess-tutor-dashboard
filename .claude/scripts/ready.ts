/**
 * Which open issues can be worked right now? Prints one line per open issue on the board:
 *
 *   #5  Todo  Feature P2  BLOCKED by #3(open) #4(open)   Sparring bot: ...
 *   #3  Todo  Feature P2  READY                          Key-moment detector: ...
 *
 * READY = open, Status Todo, not an Epic, not claimed (label in-progress), and every
 * blocker closed. Blockers are GitHub blocked-by links plus, for work in another repo
 * (GitHub can't link across repos), a body line "Waits on owner/repo#n" (several allowed).
 * Sorted READY first, then by priority. Used by /orient.
 *
 *   node .claude/scripts/ready.ts            # human-readable
 *   node .claude/scripts/ready.ts --json
 */
import { execFileSync } from "node:child_process";

const OWNER = "daveharmswebdev";
const REPO = "chess-tutor-dashboard";
const PROJECT = "6";

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8" });

interface Row {
  number: number;
  title: string;
  status: string;
  kind: string;
  priority: string;
  claimed: boolean;
  fromUser: boolean;
  blockers: { ref: string; state: string }[];
  ready: boolean;
}

const items = JSON.parse(gh(["project", "item-list", PROJECT, "--owner", OWNER, "--limit", "300", "--format", "json"])) as {
  items: { status?: string; kind?: string; priority?: string; content: { number?: number; type: string } }[];
};
const board = new Map(items.items.filter((i) => i.content.type === "Issue").map((i) => [i.content.number!, i]));

const open = JSON.parse(
  gh(["issue", "list", "--repo", `${OWNER}/${REPO}`, "--state", "open", "--limit", "300", "--json", "number,title,labels,body"]),
) as { number: number; title: string; labels: { name: string }[]; body: string }[];

/** Cross-repo blockers from "Waits on owner/repo#n" lines, e.g. "Waits on daveharmswebdev/chess-tutor#58 (...) and daveharmswebdev/chess-tutor#59". */
function crossRepoBlockers(body: string): { ref: string; state: string }[] {
  const refs = body
    .split("\n")
    .filter((l) => /^\s*Waits on\b/i.test(l))
    .flatMap((l) => [...l.matchAll(/([\w.-]+\/[\w.-]+)#(\d+)/g)].map((m) => [m[1]!, m[2]!] as const));
  return refs.map(([repo, n]) => ({
    ref: `${repo === `${OWNER}/${REPO}` ? "" : repo}#${n}`,
    state: (JSON.parse(gh(["api", `repos/${repo}/issues/${n}`])) as { state: string }).state,
  }));
}

const rows: Row[] = open.map((issue) => {
  const b = board.get(issue.number);
  const blockers = (
    JSON.parse(gh(["api", `repos/${OWNER}/${REPO}/issues/${issue.number}/dependencies/blocked_by`])) as {
      number: number;
      state: string;
    }[]
  )
    .map(({ number, state }) => ({ ref: `#${number}`, state }))
    .concat(crossRepoBlockers(issue.body ?? ""));
  const labels = issue.labels.map((l) => l.name);
  const row: Row = {
    number: issue.number,
    title: issue.title,
    status: b?.status ?? "NOT ON BOARD",
    kind: b?.kind ?? "-",
    priority: b?.priority ?? "-",
    claimed: labels.includes("in-progress"),
    fromUser: labels.includes("from-you"),
    blockers,
    ready: false,
  };
  row.ready =
    row.status === "Todo" && row.kind !== "Epic" && !row.claimed && blockers.every((x) => x.state === "closed");
  return row;
});

const prio = (p: string) => (p.startsWith("P") ? Number(p.slice(1)) : 9);
rows.sort((a, b) => Number(b.fromUser) - Number(a.fromUser) || Number(b.ready) - Number(a.ready) || prio(a.priority) - prio(b.priority) || a.number - b.number);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const r of rows) {
    const open = r.blockers.filter((x) => x.state !== "closed");
    const why = r.ready
      ? "READY"
      : r.claimed
        ? "CLAIMED"
        : open.length
          ? `BLOCKED by ${open.map((x) => x.ref).join(" ")}`
          : r.kind === "Epic"
            ? "EPIC"
            : r.status;
    console.log(`#${r.number}\t${r.status}\t${r.kind}\t${r.priority}\t${r.fromUser ? "FROM YOU " : ""}${why}\t${r.title}`);
  }
}
