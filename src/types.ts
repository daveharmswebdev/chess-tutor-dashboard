/**
 * The shape of one day's committed snapshot (snapshots/YYYY-MM-DD.json).
 * Every field is a fact copied from an API or a committed file. Nothing here is AI-written.
 */

export interface Link {
  label: string;
  url: string;
}

export interface Snapshot {
  schemaVersion: 1;
  date: string; // YYYY-MM-DD in DASHBOARD_TZ
  generatedAt: string; // ISO timestamp
  timezone: string;
  run: Link | null; // the GitHub Actions run that produced this snapshot, if any
  repo: string; // owner/name of the project being reported on
  status: Status;
  digest: Digest;
  progress: Progress;
}

export interface Status {
  appUrl: string | null;
  health: {
    checkedAt: string;
    ok: boolean;
    httpStatus: number | null;
    ms: number | null;
    error: string | null;
  } | null;
  deploy: {
    status: string; // Render deploy status, e.g. "live", "build_failed"
    commit: string | null;
    commitMessage: string | null;
    commitUrl: string | null;
    finishedAt: string | null;
  } | null;
  deployUnavailable: string | null; // why deploy is null, in plain words
  ci: {
    conclusion: string | null; // "success", "failure", ...
    url: string;
    finishedAt: string;
    commit: string;
  } | null;
}

export interface ShippedPr {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  clientNote: string | null; // from the PR's "Client note" section, word for word
  requirements: string[];
}

export interface BoardItem {
  number: number;
  title: string;
  url: string;
  status: string | null;
  priority: string | null;
  kind: string | null;
  fromClient: boolean; // carries the "from-you" label
}

export interface Digest {
  windowStart: string;
  shippedToday: ShippedPr[];
  shippedThisWeek: ShippedPr[];
  needsYou: BoardItem[];
  inProgress: BoardItem[];
  upNext: BoardItem[];
  boardUrl: string;
}

export interface RequirementProgress {
  id: string;
  label: string;
  group: string;
  state: "shipped" | "in-progress" | "not-started";
  prs: number[];
  openIssues: number[];
}

export interface Progress {
  requirements: RequirementProgress[];
  shipped: number;
  inProgress: number;
  total: number;
}
