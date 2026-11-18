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
  // The evening demo video (#6, D-6). Absent: the snapshot predates the feature (no panel).
  // null: no demo has been recorded for this date yet (today: "not run yet"; earlier day: "none ran").
  demo?: Demo | null;
}

/**
 * One run of chess-tutor's guided demo against the live app, recorded by the Demo Action (#6).
 * Every field is copied from the run: its outcome, the version the live app reported, the
 * uploaded video's address and chess-tutor's own failure step.
 */
export interface Demo {
  outcome: "success" | "failure";
  recordedAt: string; // ISO timestamp, when the run finished
  version: string | null; // full chess-tutor commit sha the live app reported; null if never confirmed
  versionUrl: string | null; // https://github.com/<repo>/commit/<version>
  // Failure only: <step> from chess-tutor's "demo stopped at <step>: <reason>", word for word.
  // null when the run succeeded or the failure named no step (the dashboard's own steps never set it).
  step: string | null;
  videoUrl: string | null; // the GitHub Release asset (full or partial video); null when none was saved
  run: Link; // the Actions run that recorded it ({ label: "Run <id>", url })
  // Scheduled runs only (#22, D-6, P-7). at: when today's recording was planned to start (ISO,
  // from the DEMO_TIME/DEMO_TZ repo variables). late: the run started more than 30 minutes after
  // that. Absent on manual runs and on snapshots from before #22.
  planned?: { at: string; late: boolean };
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
  // Old snapshots: open issues naming the ID. With Progress.rule "every-issue-done":
  // board issues naming the ID whose Status is not "Done".
  openIssues: number[];
  // Board issues naming the ID whose Status is "Done" (present when Progress.rule is set).
  doneIssues?: number[];
}

export interface Progress {
  requirements: RequirementProgress[];
  shipped: number;
  inProgress: number;
  total: number;
  // How `state` was decided. Absent (older snapshots): "shipped" once a merged PR names the ID.
  // "every-issue-done": "shipped" only when every chess-tutor board issue naming the ID has
  // Status "Done"; "in-progress" when some do; "not-started" when none do or there are none (#4).
  rule?: "every-issue-done";
}
