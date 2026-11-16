import type { Status } from "../types.ts";
import { rest } from "./github.ts";

interface RenderService {
  service: { id: string; name: string; serviceDetails?: { url?: string } };
}
interface RenderDeploy {
  deploy: {
    status: string;
    finishedAt: string | null;
    commit?: { id: string; message: string };
  };
}

async function render<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Render ${path}: ${res.status}`);
  return (await res.json()) as T;
}

async function checkHealth(appUrl: string): Promise<NonNullable<Status["health"]>> {
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  try {
    // Free/Starter instances can be slow on the first hit; give it 30 s.
    const res = await fetch(new URL("/api/health", appUrl), { signal: AbortSignal.timeout(30_000) });
    return { checkedAt, ok: res.ok, httpStatus: res.status, ms: Math.round(performance.now() - started), error: null };
  } catch (err) {
    return { checkedAt, ok: false, httpStatus: null, ms: null, error: (err as Error).name === "TimeoutError" ? "no answer within 30 s" : "could not connect" };
  }
}

export async function fetchStatus(repo: string): Promise<Status> {
  const key = process.env.RENDER_API_KEY;
  const serviceName = process.env.RENDER_SERVICE_NAME ?? "chess-tutor";
  let appUrl = process.env.APP_URL || null; // an unset Actions variable arrives as ""
  let deploy: Status["deploy"] = null;
  let deployUnavailable: string | null = null;

  if (!key) {
    deployUnavailable = "Render connection not set up yet";
  } else {
    try {
      const services = await render<RenderService[]>(`/services?name=${encodeURIComponent(serviceName)}&limit=1`, key);
      const svc = services[0]?.service;
      if (!svc) throw new Error(`no Render service named ${serviceName}`);
      appUrl ??= svc.serviceDetails?.url ?? null;
      const deploys = await render<RenderDeploy[]>(`/services/${svc.id}/deploys?limit=1`, key);
      const d = deploys[0]?.deploy;
      if (d) {
        const sha = d.commit?.id ?? null;
        deploy = {
          status: d.status,
          commit: sha,
          commitMessage: d.commit?.message.split("\n")[0] ?? null,
          commitUrl: sha ? `https://github.com/${repo}/commit/${sha}` : null,
          finishedAt: d.finishedAt,
        };
      }
    } catch (err) {
      deployUnavailable = `Render could not be reached (${(err as Error).message})`;
    }
  }

  const health = appUrl ? await checkHealth(appUrl) : null;

  let ci: Status["ci"] = null;
  try {
    const runs = await rest<{ workflow_runs: Array<{ conclusion: string | null; html_url: string; updated_at: string; head_sha: string; name: string }> }>(
      `/repos/${repo}/actions/runs?branch=main&status=completed&per_page=10`,
    );
    const run = runs.workflow_runs.find((r) => r.name === (process.env.CI_WORKFLOW_NAME ?? "CI")) ?? runs.workflow_runs[0];
    if (run) ci = { conclusion: run.conclusion, url: run.html_url, finishedAt: run.updated_at, commit: run.head_sha };
  } catch {
    ci = null;
  }

  return { appUrl, health, deploy, deployUnavailable, ci };
}
