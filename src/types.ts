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
  // Today's planned demo recording start (#29, D-6): ISO timestamp of DEMO_TIME in DEMO_TZ on this
  // snapshot's date (repo variables, default 16:00 America/Chicago). Shown while no demo has run yet.
  // Absent on snapshots from before #29.
  demoPlannedAt?: string;
  // Where this snapshot's requirement wording came from (#21, P-4): the chess-tutor commit whose
  // docs/glossary.json the dashboard's glossary.json mirrors (recorded in glossary.source.json).
  // Absent: the snapshot predates #21, or glossary.source.json was missing when it was built.
  glossarySource?: GlossarySource;
  // What the app did on this snapshot's date (#20, D-8), from chess-tutor's GET /ops/events.
  // Absent: the snapshot predates #20.
  appEvents?: AppEvents;
}

/**
 * The app's own event record for this snapshot's date (#20, D-8, FR-31). Events are the ones whose
 * `at` falls on `Snapshot.date` in `Snapshot.timezone`, in time order, demo events left out (FR-28).
 */
export interface AppEvents {
  checkedAt: string; // ISO timestamp the feed was read
  // null when the feed couldn't be read (see `unavailable`); [] means it was read and nothing happened.
  events: AppEvent[] | null;
  unavailable: string | null; // why events is null, in plain words (P-2)
  // Events left out because their code has no client wording in glossary.json's `events` (P-7).
  unworded: number;
}

export interface AppEvent {
  at: string; // ISO timestamp, from the app
  code: string; // the app's event code, e.g. "tutor.reply" (never shown on the page)
  label: string; // glossary.json events[].label for this code, word for word (P-1)
  latencyMs?: number; // tutor.reply: how long the answer took
  commit?: string; // deploy.live: the full commit sha that went live
  commitUrl?: string; // deploy.live: https://github.com/<repo>/commit/<commit> (P-4)
}

export interface GlossarySource {
  repo: string; // owner/name, e.g. "daveharmswebdev/chess-tutor"
  path: string; // the file in that repo, e.g. "docs/glossary.json"
  commit: string; // full commit sha the mirror copied it at
  url: string; // https://github.com/<repo>/blob/<commit>/<path>
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
  // Of openIssues, those whose GitHub state is CLOSED (closed but never marked Done, #14).
  // Absent (older snapshots): unknown, so every openIssues entry is labelled open.
  closedIssues?: number[];
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
