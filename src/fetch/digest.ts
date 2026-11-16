import type { BoardItem, Digest, ShippedPr } from "../types.ts";
import { graphql, restAll } from "./github.ts";

export const REQ_PATTERN = /\b(?:FR|NFR)-\d+\b/g;

interface RestPr {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  body: string | null;
  base: { ref: string };
}

/**
 * The PR's client note, word for word: the first non-empty paragraph under a heading
 * named "Client note" (any level, any case). Null if the PR has none yet.
 */
export function clientNote(body: string | null): string | null {
  if (!body) return null;
  const m = body.match(/^#{1,6}\s*client note\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im);
  const text = m?.[1]?.replace(/<!--[\s\S]*?-->/g, "").trim();
  return text ? text.split(/\n\s*\n/)[0]!.replace(/\s+/g, " ").trim() : null;
}

export function requirementIds(text: string | null): string[] {
  return [...new Set((text ?? "").match(REQ_PATTERN) ?? [])];
}

/** Every merged PR into main, newest first. */
export async function fetchMergedPrs(repo: string): Promise<ShippedPr[]> {
  const prs = await restAll<RestPr>(`/repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc`);
  return prs
    .filter((p) => p.merged_at)
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      mergedAt: p.merged_at!,
      clientNote: clientNote(p.body),
      requirements: requirementIds(`${p.title}\n${p.body ?? ""}`),
    }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}

const BOARD_QUERY = `
query($login: String!, $number: Int!, $after: String) {
  user(login: $login) {
    projectV2(number: $number) {
      url
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          kind: fieldValueByName(name: "Kind") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            ... on Issue {
              number title url state body
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
            }
          }
        }
      }
    }
  }
}`;

interface BoardNode {
  status: { name: string } | null;
  priority: { name: string } | null;
  kind: { name: string } | null;
  content: {
    number?: number;
    title?: string;
    url?: string;
    state?: string;
    body?: string;
    repository?: { nameWithOwner: string };
    labels?: { nodes: Array<{ name: string }> };
  } | null;
}

export interface OpenIssue extends BoardItem {
  requirements: string[];
}

/** Open issues on the project board for this repo, with their board fields. */
export async function fetchBoard(repo: string, owner: string, projectNumber: number): Promise<{ url: string; open: OpenIssue[] }> {
  const open: OpenIssue[] = [];
  let url = "";
  let after: string | null = null;
  do {
    const data: { user: { projectV2: { url: string; items: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: BoardNode[] } } } } =
      await graphql(BOARD_QUERY, { login: owner, number: projectNumber, after });
    const proj = data.user.projectV2;
    url = proj.url;
    for (const n of proj.items.nodes) {
      const c = n.content;
      if (!c?.number || c.state !== "OPEN" || c.repository?.nameWithOwner !== repo) continue;
      open.push({
        number: c.number,
        title: c.title!,
        url: c.url!,
        status: n.status?.name ?? null,
        priority: n.priority?.name ?? null,
        kind: n.kind?.name ?? null,
        fromClient: (c.labels?.nodes ?? []).some((l) => l.name === "from-you"),
        requirements: requirementIds(`${c.title}\n${c.body ?? ""}`),
      });
    }
    after = proj.items.pageInfo.hasNextPage ? proj.items.pageInfo.endCursor : null;
  } while (after);
  return { url, open };
}

const PRIORITY_ORDER = ["P0", "P1", "P2", "P3"];
const byPriority = (a: BoardItem, b: BoardItem) =>
  (PRIORITY_ORDER.indexOf(a.priority ?? "") + 1 || 99) - (PRIORITY_ORDER.indexOf(b.priority ?? "") + 1 || 99) || a.number - b.number;

const strip = ({ requirements: _r, ...item }: OpenIssue): BoardItem => item;

export function buildDigest(merged: ShippedPr[], board: { url: string; open: OpenIssue[] }, now: Date): Digest {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const withStatus = (s: string) => board.open.filter((i) => i.status === s).sort(byPriority).map(strip);
  return {
    windowStart: dayAgo,
    shippedToday: merged.filter((p) => p.mergedAt >= dayAgo),
    shippedThisWeek: merged.filter((p) => p.mergedAt >= weekAgo && p.mergedAt < dayAgo),
    needsYou: withStatus("Needs you"),
    inProgress: [...withStatus("In Progress"), ...withStatus("In Review")],
    upNext: withStatus("Todo").filter((i) => i.kind !== "Epic").slice(0, 5),
    boardUrl: board.url,
  };
}
