import type { GlossarySource } from "../types.ts";

export type GlossarySourceResult = { source: GlossarySource; reason: null } | { source: null; reason: string };

const FILE = "glossary.source.json";
const SHA = /^[0-9a-f]{40}$/;

/**
 * glossary.source.json (written by the mirror step, #21) to the snapshot's GlossarySource (P-4).
 * `text` is the file's contents, or null when the file is absent. Anything malformed gives a
 * plain reason and no source: a commit is copied from the file, never guessed (P-1, P-2).
 */
export function parseGlossarySource(text: string | null): GlossarySourceResult {
  if (text === null) return { source: null, reason: `${FILE} not found` };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { source: null, reason: `${FILE} is not valid JSON` };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { source: null, reason: `${FILE} is not an object` };
  const d = data as Record<string, unknown>;
  for (const key of ["repo", "path", "commit"] as const) {
    if (typeof d[key] !== "string" || d[key] === "") return { source: null, reason: `${FILE} has no ${key}` };
  }
  const { repo, path, commit } = d as { repo: string; path: string; commit: string };
  if (!SHA.test(commit)) return { source: null, reason: `${FILE}: commit is not a full 40-character commit id` };
  return { source: { repo, path, commit, url: `https://github.com/${repo}/blob/${commit}/${path}` }, reason: null };
}
