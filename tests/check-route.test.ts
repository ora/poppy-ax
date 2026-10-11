import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/check/[domain]/route";
import { readFrames, type CheckFrame } from "@/lib/check-progress";
import { checkResult, startCheck } from "@/lib/check-route";
import { configureOraClient, resetOraClient } from "@/lib/ora/client";
import { limitVisitor, visitorIp, WindowLimiter } from "@/lib/visitor-limit";

function post(domain: string, ip = "203.0.113.7", query = ""): [Request, { params: Promise<{ domain: string }> }] {
  return [
    new Request(`http://poppy.test/api/check/${domain}${query}`, { method: "POST", headers: { "x-real-ip": ip } }),
    { params: Promise.resolve({ domain }) },
  ];
}

async function frames(response: Response): Promise<CheckFrame[]> {
  return readFrames(await response.text()).frames;
}

const allow = async () => ({ ok: true }) as const;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetOraClient();
  configureOraClient({ fixtureFrameDelayMs: 0, pollIntervalMs: 1, pollBudgetMs: 50, requestTimeoutMs: 50, connectTimeoutMs: 50 });
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("POST /api/check/[domain] in fixture mode", () => {
  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "1");
    vi.stubEnv("ORA_SERVICE_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("fixture mode must not call the network"))));
  });

  it("relays the cleaned frames between poppy.ax's start and close frames", async () => {
    const response = await POST(...post("example.org", "203.0.113.1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    const list = await frames(response);
    expect(list[0]).toMatchObject({ type: "check_started" });
    expect(list.at(-1)).toMatchObject({ type: "check_closed", servedFromCache: false });
    expect(list.some((frame) => frame.type === "scan_complete")).toBe(true);
    expect(list.filter((frame) => frame.type === "check_complete").length).toBeGreaterThan(0);
    // The relay drops what the contract does not list: no roster, no result.
    const text = JSON.stringify(list);
    expect(text).not.toContain("checkRoster");
    expect(text).not.toContain("layerMaxScores");
    expect(text).not.toContain('"result"');
  });

  it("normalizes the domain before checking it", async () => {
    const list = await frames(await POST(...post("WWW.Example.org", "203.0.113.2")));
    const discovery = list.find((frame) => frame.type === "discovery_phase");
    expect(JSON.stringify(discovery)).toContain("example.org");
    expect(JSON.stringify(list)).not.toContain("WWW.");
  });

  it.each([
    ["127.0.0.1", "ip_address"],
    ["localhost", "localhost"],
    ["not_a_domain", "invalid"],
  ])("refuses %s with a 400 and its plain message", async (domain, code) => {
    const response = await POST(...post(domain, "203.0.113.3"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("invalid_domain");
    expect(body.code).toBe(code);
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("lets one visitor start 10 checks a minute, then answers 429 with when to retry", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const response = await POST(...post("example.com", "198.51.100.200"));
      statuses.push(response.status);
      await response.body?.cancel();
    }
    expect(statuses).toEqual(Array(10).fill(200));
    const over = await POST(...post("example.com", "198.51.100.200"));
    expect(over.status).toBe(429);
    const body = (await over.json()) as { error: string; retry_after: number };
    expect(body.error).toBe("busy");
    expect(body.retry_after).toBeGreaterThan(0);
    expect(over.headers.get("retry-after")).toBe(String(body.retry_after));
    // Another visitor is not affected.
    const other = await POST(...post("example.com", "198.51.100.201"));
    expect(other.status).toBe(200);
    await other.body?.cancel();
  });

  it("does not spend the visitor's budget on a refused domain", async () => {
    const limit = vi.fn(allow);
    await startCheck(post("127.0.0.1")[0], "127.0.0.1", { limit });
    expect(limit).not.toHaveBeenCalled();
  });
});

describe("POST /api/check/[domain] against Ora", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "0");
    vi.stubEnv("ORA_SERVICE_TOKEN", "test-token");
    vi.stubEnv("ORA_BASE_URL", "https://ora.test");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends only domain and activeProbes=1, never force, whatever the request carries", async () => {
    fetchMock.mockResolvedValue(
      new Response('data: {"type":"kind_detected","kind":"domain"}\n\ndata: {"type":"scan_complete","result":{}}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await startCheck(post("example.com", "203.0.113.9", "?force=1&fresh=1&maxAgeSeconds=0")[0], "example.com", {
      limit: allow,
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/scan/stream");
    expect([...url.searchParams.keys()].sort()).toEqual(["activeProbes", "domain"]);
    expect(url.searchParams.get("domain")).toBe("example.com");
    expect(url.searchParams.get("activeProbes")).toBe("1");
  });

  it("passes Ora's 429 on as busy, with its wait", async () => {
    fetchMock.mockResolvedValue(new Response("Too many requests", { status: 429, headers: { "retry-after": "42" } }));
    const response = await startCheck(post("example.com")[0], "example.com", { limit: allow });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "busy", retry_after: 42 });
  });

  it("never shows Ora's own text when it fails", async () => {
    fetchMock.mockResolvedValue(new Response("internal stack trace at db.ts:42", { status: 500 }));
    const response = await startCheck(post("example.com")[0], "example.com", { limit: allow });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("stack trace");
  });
});

describe("GET /api/check/[domain]/result", () => {
  function resultRequest(domain: string, query: string) {
    return new Request(`http://poppy.test/api/check/${domain}/result${query}`, { headers: { "x-real-ip": "203.0.113.50" } });
  }

  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "1");
    vi.stubEnv("ORA_SERVICE_TOKEN", "");
  });

  it("answers fresh for a saved result and drops the summary's cached copy", async () => {
    const revalidate = vi.fn();
    const response = await checkResult(resultRequest("example.com", `?startedAt=${Date.now()}&cached=0`), "example.com", {
      limit: allow,
      revalidate,
    });
    expect(await response.json()).toEqual({ state: "fresh" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(revalidate).toHaveBeenCalledWith("ora-summary:example.com");
  });

  it("answers not_scanned when no result was saved, and keeps the cache", async () => {
    const revalidate = vi.fn();
    const response = await checkResult(
      resultRequest("unknown-site.example.net", `?startedAt=${Date.now()}`),
      "unknown-site.example.net",
      { limit: allow, revalidate },
    );
    expect(await response.json()).toEqual({ state: "not_scanned" });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it.each(["", "?startedAt=abc", "?startedAt=0", `?startedAt=${Date.now() + 3_600_000}`, `?startedAt=${Date.now() - 3_600_000}`])(
    "refuses a start time it can't use (%s)",
    async (query) => {
      const response = await checkResult(resultRequest("example.com", query), "example.com", { limit: allow });
      expect(response.status).toBe(400);
    },
  );

  it("is limited per visitor too", async () => {
    const response = await checkResult(resultRequest("example.com", `?startedAt=${Date.now()}`), "example.com", {
      limit: async () => ({ ok: false, retryAfterSeconds: 9 }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "busy", retry_after: 9 });
  });
});

describe("visitor limit", () => {
  it("counts 10 per window per key, then says how long to wait", () => {
    const limiter = new WindowLimiter(10, 60_000);
    for (let i = 0; i < 10; i += 1) expect(limiter.hit("a", 1_000)).toEqual({ ok: true });
    expect(limiter.hit("a", 31_000)).toEqual({ ok: false, retryAfterSeconds: 30 });
    expect(limiter.hit("b", 31_000)).toEqual({ ok: true });
    expect(limiter.hit("a", 61_000)).toEqual({ ok: true });
  });

  it("keeps at most its cap of keys", () => {
    const limiter = new WindowLimiter(1, 60_000, 3);
    for (let i = 0; i < 10; i += 1) limiter.hit(`k${i}`, 0);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });

  it("reads the visitor's IP from Vercel's header first", () => {
    expect(visitorIp(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }))).toBe("1.2.3.4");
    expect(visitorIp(new Headers({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" }))).toBe("5.6.7.8");
    expect(visitorIp(new Headers())).toBe("unknown");
  });

  const request = new Request("http://poppy.test/api/check/x", { headers: { "x-real-ip": "1.2.3.4" } });

  it("asks the firewall rule on Vercel when its id is set", async () => {
    const firewall = vi.fn(async () => ({ rateLimited: true }));
    const result = await limitVisitor(request, "check", {
      env: { POPPY_CHECK_RATE_LIMIT_ID: "poppy-checks", VERCEL: "1" },
      firewall,
      local: new WindowLimiter(),
    });
    expect(result.ok).toBe(false);
    expect(firewall).toHaveBeenCalledWith("poppy-checks", expect.objectContaining({ rateLimitKey: "check:1.2.3.4" }));
  });

  it("falls back to the local limit off Vercel, without a rule id, or when the rule is missing", async () => {
    const firewall = vi.fn(async () => ({ rateLimited: false, error: "not-found" as const }));
    for (const env of [{ POPPY_CHECK_RATE_LIMIT_ID: "poppy-checks" }, { VERCEL: "1" }, { POPPY_CHECK_RATE_LIMIT_ID: "x", VERCEL: "1" }]) {
      const local = new WindowLimiter(1, 60_000);
      expect(await limitVisitor(request, "check", { env, firewall, local, now: 0 })).toEqual({ ok: true });
      expect((await limitVisitor(request, "check", { env, firewall, local, now: 0 })).ok).toBe(false);
    }
    expect(firewall).toHaveBeenCalledTimes(2);
  });

  it("falls back to the local limit when the firewall call throws", async () => {
    const firewall = vi.fn(async () => {
      throw new Error("no ip");
    });
    const local = new WindowLimiter(1, 60_000);
    const env = { POPPY_CHECK_RATE_LIMIT_ID: "poppy-checks", VERCEL: "1" };
    expect(await limitVisitor(request, "result", { env, firewall, local, now: 0 })).toEqual({ ok: true });
    expect((await limitVisitor(request, "result", { env, firewall, local, now: 0 })).ok).toBe(false);
  });
});
