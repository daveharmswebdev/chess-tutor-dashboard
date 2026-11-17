import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStatus } from "../../src/fetch/status.ts";

/** Stub global fetch by URL substring; anything unmatched rejects, so no test can reach the network (P-6). */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    for (const [part, respond] of Object.entries(routes)) if (url.includes(part)) return respond();
    throw new Error(`unexpected network call in test: ${url}`);
  });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fetchStatus degrades honestly (P-2)", () => {
  it("says Render isn't set up when there's no key, and still checks health and CI", async () => {
    vi.stubEnv("RENDER_API_KEY", "");
    vi.stubEnv("APP_URL", "https://app.example");
    vi.stubEnv("GH_TOKEN", "test-token");
    stubFetch({
      "app.example/api/health": () => new Response("ok"),
      "api.github.com": () => json({ workflow_runs: [{ name: "CI", conclusion: "success", html_url: "https://gh/run/1", updated_at: "2026-11-16T00:00:00Z", head_sha: "abc" }] }),
    });
    const s = await fetchStatus("o/r");
    expect(s.deploy).toBeNull();
    expect(s.deployUnavailable).toBe("Render connection not set up yet");
    expect(s.health).toMatchObject({ ok: true, httpStatus: 200 });
    expect(s.ci).toMatchObject({ conclusion: "success", commit: "abc" });
  });

  it("reports a down app and an unreachable Render in plain words instead of throwing", async () => {
    vi.stubEnv("RENDER_API_KEY", "k");
    vi.stubEnv("APP_URL", "https://app.example");
    vi.stubEnv("GH_TOKEN", "test-token");
    stubFetch({
      "api.render.com": () => json({ message: "unauthorized" }, 401),
      "app.example/api/health": () => new Response("down", { status: 503 }),
      "api.github.com": () => json({ message: "nope" }, 500),
    });
    const s = await fetchStatus("o/r");
    expect(s.deployUnavailable).toMatch(/^Render could not be reached/);
    expect(s.health).toMatchObject({ ok: false, httpStatus: 503 });
    expect(s.ci).toBeNull();
  });

  it("treats an empty APP_URL as unset and uses the Render service URL", async () => {
    vi.stubEnv("RENDER_API_KEY", "k");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("GH_TOKEN", "test-token");
    stubFetch({
      "/v1/services?": () => json([{ service: { id: "srv-1", name: "chess-tutor", serviceDetails: { url: "https://svc.example" } } }]),
      "/v1/services/srv-1/deploys": () => json([{ deploy: { status: "live", finishedAt: "2026-11-15T20:46:32Z", commit: { id: "3a56c1d0", message: "Notes (#56)\n\nbody" } } }]),
      "svc.example/api/health": () => new Response("ok"),
      "api.github.com": () => json({ workflow_runs: [] }),
    });
    const s = await fetchStatus("o/r");
    expect(s.appUrl).toBe("https://svc.example");
    expect(s.deploy).toMatchObject({ status: "live", commit: "3a56c1d0", commitMessage: "Notes (#56)", commitUrl: "https://github.com/o/r/commit/3a56c1d0" });
  });
});
