import { execFileSync } from "node:child_process";

/** GH_TOKEN in CI; locally falls back to the logged-in gh CLI. */
function token(): string {
  const t = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (t) return t;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No GitHub token: set GH_TOKEN or log in with `gh auth login`.");
  }
}

const headers = () => ({
  Authorization: `Bearer ${token()}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "chess-tutor-dashboard",
});

export async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Follows page=N until a short page comes back. */
export async function restAll<T>(path: string, max = 1000): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; out.length < max; page++) {
    const batch = await rest<T[]>(`${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || body.errors) throw new Error(`GitHub GraphQL: ${res.status} ${JSON.stringify(body.errors)}`);
  return body.data as T;
}
