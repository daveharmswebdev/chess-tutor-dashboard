/**
 * GET /demo/<date>.mp4 serves the day's demo video with headers iOS will play (#18, D-6, P-6).
 * Uses Fastify's inject() and a stubbed fetch: no real port, no network.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "../../src/server.ts";
import type { Demo } from "../../src/types.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/snapshot.json", import.meta.url), "utf8"));
const VIDEO = "https://github.com/daveharmswebdev/chess-tutor-dashboard/releases/download/demos/demo-2026-11-17.mp4";
const DEMO: Demo = {
  outcome: "success",
  recordedAt: "2026-11-17T12:53:08.995Z",
  version: "621270d89f9b95b9632a336fbd63e52574a87f37",
  versionUrl: "https://github.com/daveharmswebdev/chess-tutor/commit/621270d89f9b95b9632a336fbd63e52574a87f37",
  step: null,
  videoUrl: VIDEO,
  run: { label: "Run 1", url: "https://github.com/daveharmswebdev/chess-tutor-dashboard/actions/runs/1" },
};
const BYTES = Buffer.from("not-really-an-mp4-but-bytes-are-bytes");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** One snapshot per date; `demo` undefined leaves the field out (older snapshot). */
function dir(days: Record<string, Demo | null | undefined>): string {
  const d = mkdtempSync(join(tmpdir(), "dashboard-demo-"));
  dirs.push(d);
  for (const [date, demo] of Object.entries(days)) {
    const snap = { ...fixture, date, ...(demo === undefined ? {} : { demo }) };
    writeFileSync(join(d, `${date}.json`), JSON.stringify(snap));
  }
  return d;
}

interface Call { url: string; init: RequestInit | undefined }
/** A fetch stub that records calls and answers only the expected video URL. */
function stub(answer: (init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url !== VIDEO) throw new Error(`unexpected fetch: ${url}`);
    return answer(init);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}
const ok = () =>
  new Response(BYTES, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": "attachment; filename=demo-2026-11-17.mp4",
      "content-length": String(BYTES.length),
      "last-modified": "Tue, 17 Nov 2026 12:53:10 GMT",
      etag: '"abc"',
    },
  });

async function app(days: Record<string, Demo | null | undefined>, answer: Parameters<typeof stub>[0] = ok, password?: string, extra: Partial<AppOptions> = {}) {
  const s = stub(answer);
  const a = await buildApp({ password, snapshotsDir: dir(days), fetch: s.fetch, ...extra });
  return { app: a, calls: s.calls };
}

/** Collects every log line the app writes (Fastify's pino logger, JSON lines). */
function logSink() {
  const lines: string[] = [];
  return { lines, logger: { level: "trace", stream: { write: (msg: string) => void lines.push(msg) } } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An upstream body like real fetch's: it errors with the signal's reason if the signal aborts. */
function slowBody(chunks: Buffer[], gapMs: number, signal: AbortSignal | null | undefined) {
  return new ReadableStream<Uint8Array>({
    async start(c) {
      signal?.addEventListener("abort", () => {
        try {
          c.error(signal.reason);
        } catch {}
      });
      for (const chunk of chunks) {
        await sleep(gapMs);
        if (signal?.aborted) return;
        try {
          c.enqueue(new Uint8Array(chunk));
        } catch {
          return;
        }
      }
      try {
        c.close();
      } catch {}
    },
  });
}

describe("/demo/:file refuses anything it should not proxy (#18, P-6)", () => {
  it("unknown date is 404 and fetches nothing", async () => {
    const { app: a, calls } = await app({ "2026-11-17": DEMO });
    const res = await a.inject({ url: "/demo/2026-11-18.mp4" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(calls).toHaveLength(0);
    await a.close();
  });

  for (const file of ["..%2F2026-11-17.json", "2026-11-17.json", "2026-11-17", "2026-11-17.mp4x", "x2026-11-17.mp4", "2026-11-17.mp4.mp4", "2026-1-17.mp4", "..%2F..%2Fetc%2Fpasswd"]) {
    it(`malformed ${file} is 404 and fetches nothing`, async () => {
      const { app: a, calls } = await app({ "2026-11-17": DEMO });
      const res = await a.inject({ url: `/demo/${file}` });
      expect(res.statusCode).toBe(404);
      expect(calls).toHaveLength(0);
      await a.close();
    });
  }

  it("a path traversal is not routed to the video", async () => {
    const { app: a, calls } = await app({ "2026-11-17": DEMO });
    const res = await a.inject({ url: "/demo/../2026-11-17.mp4" });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
    await a.close();
  });

  const bad: [string, Demo | null | undefined][] = [
    ["no demo field (older snapshot)", undefined],
    ["demo null", null],
    ["videoUrl null", { ...DEMO, videoUrl: null }],
    ["http videoUrl", { ...DEMO, videoUrl: VIDEO.replace("https:", "http:") }],
    ["non-github host", { ...DEMO, videoUrl: "https://example.com/demo.mp4" }],
    ["github lookalike host", { ...DEMO, videoUrl: "https://github.com.evil.test/demo.mp4" }],
    ["userinfo trick", { ...DEMO, videoUrl: "https://github.com@evil.test/demo.mp4" }],
    ["not a URL", { ...DEMO, videoUrl: "javascript:alert(1)" }],
  ];
  for (const [name, demo] of bad) {
    it(`${name} is 404 and fetches nothing`, async () => {
      const { app: a, calls } = await app({ "2026-11-17": demo });
      const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(calls).toHaveLength(0);
      await a.close();
    });
  }

  it("a damaged snapshot is 404 and fetches nothing", async () => {
    const d = dir({});
    writeFileSync(join(d, "2026-11-17.json"), "{ not json");
    const s = stub(ok);
    const a = await buildApp({ password: undefined, snapshotsDir: d, fetch: s.fetch });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(404);
    expect(s.calls).toHaveLength(0);
    await a.close();
  });
});

describe("/demo/:file serves the video with playable headers (#18, D-6)", () => {
  it("200 upstream: video/mp4, no content-disposition, length and validators passed, same bytes", async () => {
    const { app: a, calls } = await app({ "2026-11-17": DEMO });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.headers["content-length"]).toBe(String(BYTES.length));
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["last-modified"]).toBe("Tue, 17 Nov 2026 12:53:10 GMT");
    expect(res.headers["etag"]).toBe('"abc"');
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.rawPayload.equals(BYTES)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.redirect).toBe("follow");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(new Headers(calls[0]!.init?.headers).get("range")).toBeNull();
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    await a.close();
  });

  it("forwards Range and passes 206 with content-range through", async () => {
    const { app: a, calls } = await app({ "2026-11-17": DEMO }, (init) => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-1");
      return new Response(BYTES.subarray(0, 2), {
        status: 206,
        headers: { "content-range": `bytes 0-1/${BYTES.length}`, "content-length": "2", "accept-ranges": "bytes", "content-type": "application/octet-stream" },
      });
    });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4", headers: { range: "bytes=0-1" } });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-1/${BYTES.length}`);
    expect(res.headers["content-length"]).toBe("2");
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.rawPayload.equals(BYTES.subarray(0, 2))).toBe(true);
    expect(calls).toHaveLength(1);
    await a.close();
  });

  it("passes 416 through", async () => {
    const { app: a } = await app({ "2026-11-17": DEMO }, () => new Response(null, { status: 416, headers: { "content-range": `bytes */${BYTES.length}` } }));
    const res = await a.inject({ url: "/demo/2026-11-17.mp4", headers: { range: "bytes=999999-" } });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${BYTES.length}`);
    await a.close();
  });

  it("serves a failure snapshot's partial video too", async () => {
    const { app: a } = await app({ "2026-11-17": { ...DEMO, outcome: "failure", step: "the tutor's question" } });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(BYTES)).toBe(true);
    await a.close();
  });

  it("HEAD works with the same headers and no body", async () => {
    const { app: a, calls } = await app({ "2026-11-17": DEMO }, (init) =>
      init?.method === "HEAD" ? new Response(null, { status: 200, headers: { "content-length": String(BYTES.length) } }) : ok());
    const res = await a.inject({ method: "HEAD", url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.init?.method).toBe("HEAD");
    expect(res.headers["content-length"]).toBe(String(BYTES.length));
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.body).toBe("");
    await a.close();
  });
});

describe("/demo/:file says plainly when GitHub fails (P-2, P-7)", () => {
  const TEXT = "The demo video could not be loaded from GitHub.";
  for (const status of [404, 500, 403]) {
    it(`upstream ${status} is 502 with the plain reason`, async () => {
      const { app: a } = await app({ "2026-11-17": DEMO }, () => new Response("nope", { status }));
      const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
      expect(res.statusCode).toBe(502);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.body).toBe(TEXT);
      await a.close();
    });
  }

  it("a thrown fetch is 502", async () => {
    const { app: a } = await app({ "2026-11-17": DEMO }, () => {
      throw new TypeError("fetch failed");
    });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(502);
    expect(res.body).toBe(TEXT);
    await a.close();
  });

  it("a timeout is 502", async () => {
    const { app: a } = await app({ "2026-11-17": DEMO }, () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(502);
    expect(res.body).toBe(TEXT);
    await a.close();
  });
});

describe("/demo/:file stays behind the password (O-2, P-6)", () => {
  const PASSWORD = "test-only-password";
  const basic = (pass: string) => `Basic ${Buffer.from(`client:${pass}`).toString("base64")}`;

  it("is 401 without credentials and fetches nothing", async () => {
    const { app: a, calls } = await app({ "2026-11-17": DEMO }, ok, PASSWORD);
    for (const method of ["GET", "HEAD"] as const) {
      const res = await a.inject({ method, url: "/demo/2026-11-17.mp4" });
      expect(res.statusCode).toBe(401);
    }
    expect((await a.inject({ url: "/demo/2026-11-17.mp4", headers: { authorization: basic("wrong") } })).statusCode).toBe(401);
    expect(calls).toHaveLength(0);
    await a.close();
  });

  it("is 200 with the password", async () => {
    const { app: a } = await app({ "2026-11-17": DEMO }, ok, PASSWORD);
    const res = await a.inject({ url: "/demo/2026-11-17.mp4", headers: { authorization: basic(PASSWORD) } });
    expect(res.statusCode).toBe(200);
    await a.close();
  });
});

describe("/demo/:file only proxies release assets (#18, P-6)", () => {
  for (const videoUrl of ["https://github.com/daveharmswebdev/chess-tutor/blob/main/demo.mp4", "https://github.com/login", "https://github.com/o/r/releases/download/demos/demo.mov"]) {
    it(`${videoUrl} is 404 and fetches nothing`, async () => {
      const { app: a, calls } = await app({ "2026-11-17": { ...DEMO, videoUrl } });
      const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
      expect(res.statusCode).toBe(404);
      expect(calls).toHaveLength(0);
      await a.close();
    });
  }
});

describe("/demo/:file timeouts cover the response headers only (#18, P-2)", () => {
  it("a body that takes longer than the header timeout still completes", async () => {
    const chunks = [BYTES.subarray(0, 10), BYTES.subarray(10, 20), BYTES.subarray(20)];
    const { app: a } = await app(
      { "2026-11-17": DEMO },
      (init) => new Response(slowBody(chunks, 60, init?.signal), { status: 200, headers: { "content-length": String(BYTES.length) } }),
      undefined,
      { demoHeaderTimeoutMs: 50 },
    );
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(BYTES)).toBe(true);
    await a.close();
  });

  it("headers slower than the timeout are 502", async () => {
    const { app: a } = await app(
      { "2026-11-17": DEMO },
      (init) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(ok()), 1000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(init.signal!.reason);
          });
        }),
      undefined,
      { demoHeaderTimeoutMs: 30 },
    );
    const started = Date.now();
    const res = await a.inject({ url: "/demo/2026-11-17.mp4" });
    expect(res.statusCode).toBe(502);
    expect(res.body).toBe("The demo video could not be loaded from GitHub.");
    expect(Date.now() - started).toBeLessThan(900);
    await a.close();
  });
});

describe("/demo/:file survives a broken stream (#18, P-2)", () => {
  it("an upstream body that errors mid-stream ends that response and the server stays up", async () => {
    const { app: a } = await app({ "2026-11-17": DEMO }, () => {
      const body = new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(new Uint8Array(BYTES.subarray(0, 5)));
          await sleep(10);
          c.error(new Error("upstream connection reset"));
        },
      });
      return new Response(body, { status: 200, headers: { "content-length": String(BYTES.length) } });
    });
    await expect(a.inject({ url: "/demo/2026-11-17.mp4" })).rejects.toThrow();
    const health = await a.inject({ url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    await a.close();
  });

  it("a client that disconnects mid-stream cancels the upstream body", async () => {
    let cancelled = false;
    const { app: a } = await app({ "2026-11-17": DEMO }, () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(BYTES.subarray(0, 5)));
          // then never sends more and never closes
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    });
    const res = await a.inject({ url: "/demo/2026-11-17.mp4", payloadAsStream: true });
    expect(res.statusCode).toBe(200);
    const stream = res.stream();
    stream.on("error", () => {});
    await new Promise((r) => stream.once("data", r));
    (res.raw.res as unknown as { destroy(): void }).destroy();
    for (let i = 0; i < 50 && !cancelled; i++) await sleep(10);
    expect(cancelled).toBe(true);
    await a.close();
  });
});

describe("/demo/:file never logs a URL or a credential (#18, P-6)", () => {
  const PASSWORD = "test-only-password";
  const auth = { authorization: `Basic ${Buffer.from(`client:${PASSWORD}`).toString("base64")}` };
  const SIGNED = "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=SECRET";

  const answers: [string, Parameters<typeof stub>[0]][] = [
    ["success", ok],
    ["upstream 500", () => new Response("nope", { status: 500 })],
    [
      "fetch throws naming the redirect target",
      () => {
        throw new TypeError(`fetch failed for ${SIGNED}`, { cause: new Error(`connect ECONNRESET ${SIGNED}`) });
      },
    ],
    [
      "body errors naming the redirect target",
      () => new Response(new ReadableStream({ start: (c) => c.error(new Error(`terminated ${SIGNED}`)) }), { status: 200 }),
    ],
  ];
  for (const [name, answer] of answers) {
    it(`${name}: logs hold no URL, release-assets host or Authorization`, async () => {
      const sink = logSink();
      const { app: a } = await app({ "2026-11-17": DEMO }, answer, PASSWORD, { logger: sink.logger });
      await a.inject({ url: "/demo/2026-11-17.mp4", headers: auth }).catch(() => {});
      await sleep(20);
      await a.close();
      const log = sink.lines.join("");
      expect(sink.lines.length).toBeGreaterThan(0);
      expect(log).not.toContain(VIDEO);
      expect(log).not.toContain("release-assets");
      expect(log).not.toContain("githubusercontent");
      expect(log).not.toContain("SECRET");
      expect(log).not.toContain(auth.authorization);
      expect(log).not.toContain(Buffer.from(`client:${PASSWORD}`).toString("base64"));
      expect(log).not.toContain(PASSWORD);
      expect(log.toLowerCase()).not.toContain("authorization");
    });
  }
});
