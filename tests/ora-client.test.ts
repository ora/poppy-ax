import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  checkToken,
  configureOraClient,
  getCatalog,
  getSites,
  getSummary,
  isFreshSummary,
  pollFreshSummary,
  resetOraClient,
  streamScan,
  summaryTag,
} from "@/lib/ora/client";
import { parseSseFrames, relayScanEvents } from "@/lib/ora/sse";
import type { ScanStreamResult, Summary } from "@/lib/ora/types";

const FIXTURES = join(process.cwd(), "fixtures");

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

const SUMMARY_FIXTURES = [
  ["summary-not-set-up.json", "example.com", "not_set_up"],
  ["summary-demo-receiver.json", "poppy-receiver.roundtrip.workers.dev", "working"],
  ["summary-failing-p0.json", "failing-p0.example.com", "problems"],
  ["summary-timeout.json", "timeout.example.com", "working"],
  ["summary-unreachable.json", "unreachable.example.com", "unreachable"],
  ["summary-owner-opt-out.json", "opt-out.example.com", "working"],
] as const;

const INVALID_INPUTS = [
  ["not a domain", "invalid_domain"],
  ["", "invalid_domain"],
  ["example.com/path", "has_path"],
  ["example.com:8443", "has_port"],
  ["127.0.0.1", "ip_address"],
  ["localhost", "localhost"],
] as const;

const BASE = "https://ora.test";
const TOKEN = "test-token-123";

const fetchMock = vi.fn<typeof fetch>();
let warn: MockInstance<typeof console.warn>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sse(frames: string[], headers: Record<string, string> = {}): Response {
  return new Response(frames.map((frame) => `data: ${frame}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...headers },
  });
}

/** A fetch that never answers until its signal aborts. */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

function calledUrl(index = 0): URL {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`fetch call ${index} missing`);
  return new URL(String(call[0]));
}

function calledInit(index = 0): RequestInit {
  return fetchMock.mock.calls[index]?.[1] ?? {};
}

async function readAll(result: ScanStreamResult): Promise<string> {
  if (result.kind !== "ok") throw new Error(`expected a stream, got ${JSON.stringify(result)}`);
  return new Response(result.body).text();
}

beforeEach(() => {
  resetOraClient();
  configureOraClient({
    requestTimeoutMs: 50,
    connectTimeoutMs: 50,
    retryDelayMs: 0,
    pollIntervalMs: 1,
    pollBudgetMs: 200,
    fixtureFrameDelayMs: 0,
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("fixture mode", () => {
  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "1");
    vi.stubEnv("ORA_SERVICE_TOKEN", "");
    fetchMock.mockImplementation(() => {
      throw new Error("fixture mode must not call the network");
    });
  });

  it.each(SUMMARY_FIXTURES)("serves %s by its own domain", async (file, domain, verdict) => {
    const result = await getSummary(domain);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.domain).toBe(domain);
    expect(result.summary.verdict).toBe(verdict);
    expect(result.summary).toEqual(fixture(file));
  });

  it("reads www. as the domain without it", async () => {
    const result = await getSummary("https://www.example.com/");
    expect(result.kind === "ok" && result.summary.domain).toBe("example.com");
  });

  it("answers not_scanned for a domain with no fixture", async () => {
    expect(await getSummary("unknown-site.example.net")).toEqual({ kind: "not_scanned" });
  });

  it.each(INVALID_INPUTS)("answers %j with the recorded code %s", async (input, code) => {
    expect(await getSummary(input)).toEqual({ kind: "invalid", code });
  });

  it("serves the sites list and the catalog", async () => {
    expect(await getSites()).toEqual(fixture("sites.json").sites);
    const catalog = await getCatalog();
    expect(catalog?.rows).toHaveLength(100);
    expect(catalog?.profile).toBe("pap-0.1@2026-10-09");
  });

  it("replays the recorded scan for the requested domain and ends with scan_complete", async () => {
    const text = await readAll(await streamScan("www.shop.example.net"));
    const frames = parseSseFrames(text) as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(132);
    expect(frames[0]?.type).toBe("kind_detecting");
    expect(frames.at(-1)).toEqual({ type: "scan_complete", timestamp: 1791676171570 });
    const phases = frames.filter((frame) => frame.type === "discovery_phase");
    expect(phases[0]?.label).toBe("Fetching shop.example.net");
    expect(text).not.toContain("example.org");
    // Ora's general scan data is not relayed.
    expect(text).not.toContain("checkRoster");
    expect(text).not.toContain("layerMaxScores");
  });

  it("stops the replay when the caller aborts", async () => {
    configureOraClient({ fixtureFrameDelayMs: 5 });
    const controller = new AbortController();
    const result = await streamScan("example.com", controller.signal);
    if (result.kind !== "ok") throw new Error("expected a stream");
    const reader = result.body.getReader();
    await reader.read();
    controller.abort();
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) return;
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses an invalid domain before replaying", async () => {
    expect(await streamScan("localhost")).toEqual({ kind: "invalid", code: "localhost" });
  });

  it("counts the fixture summary as fresh and accepts any token", async () => {
    const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
    expect(result.kind).toBe("ok");
    expect(await checkToken()).toEqual({ kind: "ok", status: null });
  });
});

describe("network mode", () => {
  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "0");
    vi.stubEnv("ORA_BASE_URL", BASE);
    vi.stubEnv("ORA_SERVICE_TOKEN", TOKEN);
  });

  describe("getSummary", () => {
    it("returns the summary and sends the token, the domain and nothing else", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("summary-failing-p0.json")));
      const result = await getSummary("www.Failing-P0.example.com");
      expect(result.kind === "ok" && result.summary.verdict).toBe("problems");
      const url = calledUrl();
      expect(url.origin + url.pathname).toBe(`${BASE}/api/pap/v1/summary`);
      expect([...url.searchParams.entries()]).toEqual([["domain", "failing-p0.example.com"]]);
      const headers = new Headers(calledInit().headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(calledInit().next).toEqual({ revalidate: 60, tags: ["ora-summary:failing-p0.example.com"] });
      expect(calledInit().redirect).toBe("error");
    });

    it("passes the not_checked verdict and check_error rows through (Ruling R70)", async () => {
      const raw = fixture("summary-unreachable.json");
      const rows = (raw.rows as Array<Record<string, unknown>>).map((row) =>
        row.reason === "timeout" ? { ...row, reason: "check_error" } : row,
      );
      fetchMock.mockResolvedValue(json(200, { ...raw, verdict: "not_checked", rows }));
      const result = await getSummary("unreachable.example.com");
      expect(result.kind === "ok" && result.summary.verdict).toBe("not_checked");
      expect(result.kind === "ok" && result.summary.rows.find((row) => row.id === "T0-01")?.reason).toBe("check_error");
    });

    it("skips every cache when asked for a fresh summary", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("summary-not-set-up.json")));
      await getSummary("example.com", { fresh: true });
      expect(calledInit().cache).toBe("no-store");
      expect(calledInit().next).toBeUndefined();
      expect(new Headers(calledInit().headers).get("cache-control")).toBe("no-cache");
    });

    it("keeps a subdomain Ora answers with", async () => {
      const body = { ...fixture("summary-not-set-up.json"), domain: "shop.example.com" };
      fetchMock.mockResolvedValue(json(200, body));
      const result = await getSummary("shop.example.com");
      expect(result.kind === "ok" && result.summary.domain).toBe("shop.example.com");
    });

    it("answers not_scanned for a 404", async () => {
      fetchMock.mockResolvedValue(json(404, fixture("errors/not-scanned.json")));
      expect(await getSummary("example.com")).toEqual({ kind: "not_scanned" });
    });

    it("answers a 404 without the not_scanned code as an error", async () => {
      fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "upstream", status: 404 });
    });

    it.each(["invalid_domain", "has_path", "has_port", "ip_address", "localhost"])(
      "maps a 400 %s",
      async (code) => {
        fetchMock.mockResolvedValue(json(400, { error: code }));
        expect(await getSummary("example.com")).toEqual({ kind: "invalid", code });
      },
    );

    it("reads a 400 code it does not know as invalid_domain", async () => {
      fetchMock.mockResolvedValue(json(400, { error: "something_new" }));
      expect(await getSummary("example.com")).toEqual({ kind: "invalid", code: "invalid_domain" });
    });

    it("refuses a domain lib/domain.ts refuses without calling Ora", async () => {
      for (const [input, code] of INVALID_INPUTS) {
        expect(await getSummary(input)).toEqual({ kind: "invalid", code });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers a 401 as unauthorized", async () => {
      fetchMock.mockResolvedValue(json(401, fixture("errors/unauthorized.json")));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "unauthorized", status: 401 });
    });

    it("answers a 429 as busy with when to retry", async () => {
      fetchMock.mockResolvedValue(json(429, { error: "rate_limited" }, { "retry-after": "12" }));
      expect(await getSummary("example.com")).toEqual({
        kind: "error",
        code: "busy",
        status: 429,
        retryAfterSeconds: 12,
      });
    });

    it("retries a 500 once, then gives up", async () => {
      fetchMock.mockImplementation(async () => json(500, { error: "internal_error" }));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "upstream", status: 500 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns the summary when the retry after a 500 succeeds", async () => {
      fetchMock
        .mockResolvedValueOnce(json(500, { error: "internal_error" }))
        .mockResolvedValueOnce(json(200, fixture("summary-not-set-up.json")));
      expect((await getSummary("example.com")).kind).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("answers a 503 as upstream after one retry", async () => {
      fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "upstream", status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("times out", async () => {
      fetchMock.mockImplementation(hangingFetch());
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "timeout" });
    });

    it("says aborted when the caller aborts", async () => {
      fetchMock.mockImplementation(hangingFetch());
      const controller = new AbortController();
      const pending = getSummary("example.com", { signal: controller.signal });
      controller.abort();
      expect(await pending).toEqual({ kind: "error", code: "aborted" });
    });

    it("answers a network failure as an error", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "network" });
    });

    it("answers malformed JSON as bad_response", async () => {
      fetchMock.mockResolvedValue(new Response("{not json", { status: 200 }));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "bad_response", status: 200 });
    });

    it.each([
      ["a missing report_url", (body: Record<string, unknown>) => delete body.report_url],
      ["a report_url that is not https", (body: Record<string, unknown>) => (body.report_url = "javascript:alert(1)")],
      ["a missing count", (body: Record<string, unknown>) => delete (body.counts as Record<string, unknown>).tier3],
      ["a row with no note field", (body: Record<string, unknown>) => delete (body.rows as Array<Record<string, unknown>>)[0]?.note],
      ["a domain with a path", (body: Record<string, unknown>) => (body.domain = "example.com/evil")],
      ["rows that are not a list", (body: Record<string, unknown>) => (body.rows = {})],
    ])("answers %s as bad_response", async (_name, spoil) => {
      const body = fixture("summary-failing-p0.json");
      spoil(body);
      fetchMock.mockResolvedValue(json(200, body));
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "bad_response", status: 200 });
    });

    it("passes unknown verdicts, outcomes and reasons through and drops unknown fields", async () => {
      const body = fixture("summary-failing-p0.json");
      body.verdict = "something_new";
      body.extra = "<script>";
      const rows = body.rows as Array<Record<string, unknown>>;
      rows[0] = { ...rows[0], outcome: "skipped", reason: "probe_cooldown", note: "<b>plain</b>", extra: 1 };
      rows[1] = { ...rows[1], reason: "check_error" };
      rows[2] = { ...rows[2], reason: "brand_new_reason" };
      fetchMock.mockResolvedValue(json(200, body));
      const result = await getSummary("example.com");
      if (result.kind !== "ok") throw new Error(JSON.stringify(result));
      const summary: Summary = result.summary;
      expect(summary.verdict).toBe("something_new");
      expect(summary).not.toHaveProperty("extra");
      expect(summary.rows[0]).toEqual({ ...rows[0], extra: undefined });
      expect(summary.rows[0]).not.toHaveProperty("extra");
      expect(summary.rows[0]?.note).toBe("<b>plain</b>");
      expect(summary.rows[1]?.reason).toBe("check_error");
      expect(summary.rows[2]?.reason).toBe("brand_new_reason");
    });

    it.each(["", "replace-me", undefined])("refuses to call Ora with the token %j and logs it once", async (token) => {
      if (token === undefined) delete process.env.ORA_SERVICE_TOKEN;
      else vi.stubEnv("ORA_SERVICE_TOKEN", token);
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "no_token" });
      expect(await getSummary("example.org")).toEqual({ kind: "error", code: "no_token" });
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "no_token" });
      expect(await getSites()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      const tokenWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("ORA_SERVICE_TOKEN"));
      expect(tokenWarnings).toHaveLength(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    });

    it("refuses a base URL that is not http(s)", async () => {
      vi.stubEnv("ORA_BASE_URL", "ftp://ora.test");
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "bad_config" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("defaults the base URL to https://ora.ai", async () => {
      vi.stubEnv("ORA_BASE_URL", "");
      fetchMock.mockResolvedValue(json(404, { error: "not_scanned" }));
      await getSummary("example.com");
      expect(calledUrl().origin).toBe("https://ora.ai");
    });
  });

  describe("isFreshSummary", () => {
    const started = Date.parse("2026-10-11T10:00:00.000Z");

    it("accepts a result saved after the stream began, or up to 5 seconds before", () => {
      expect(isFreshSummary({ last_run: "2026-10-11T10:00:03.000Z" }, started, false)).toBe(true);
      expect(isFreshSummary({ last_run: "2026-10-11T09:59:55.000Z" }, started, false)).toBe(true);
    });

    it("refuses an older result, unless the stream served a stored one", () => {
      expect(isFreshSummary({ last_run: "2026-10-11T09:59:54.999Z" }, started, false)).toBe(false);
      expect(isFreshSummary({ last_run: "2026-10-10T22:50:02.971Z" }, started, true)).toBe(true);
    });

    it("refuses a last_run it cannot read", () => {
      expect(isFreshSummary({ last_run: "yesterday" }, started, false)).toBe(false);
    });
  });

  describe("pollFreshSummary", () => {
    function summaryAt(lastRun: string) {
      return json(200, { ...fixture("summary-not-set-up.json"), last_run: lastRun });
    }

    it("waits through not_scanned and the old result for the fresh one", async () => {
      const started = Date.now();
      fetchMock
        .mockResolvedValueOnce(json(404, { error: "not_scanned" }))
        .mockResolvedValueOnce(summaryAt(new Date(started - 3_600_000).toISOString()))
        .mockResolvedValueOnce(summaryAt(new Date(started + 1_000).toISOString()));
      const result = await pollFreshSummary("example.com", { streamStartedAt: started, wasCacheHit: false });
      expect(result.kind).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      for (let index = 0; index < 3; index += 1) expect(calledInit(index).cache).toBe("no-store");
    });

    it("accepts the stored result at once after a cache hit", async () => {
      fetchMock.mockResolvedValue(summaryAt("2026-10-10T00:00:00.000Z"));
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: true });
      expect(result.kind).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("answers stale with the old result when the time runs out", async () => {
      configureOraClient({ pollBudgetMs: 30, pollIntervalMs: 5 });
      fetchMock.mockImplementation(async () => summaryAt("2026-10-10T00:00:00.000Z"));
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
      expect(result.kind).toBe("stale");
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });

    it("answers not_scanned when nothing was saved in time", async () => {
      configureOraClient({ pollBudgetMs: 20, pollIntervalMs: 5 });
      fetchMock.mockImplementation(async () => json(404, { error: "not_scanned" }));
      expect(await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false })).toEqual({
        kind: "not_scanned",
      });
    });

    it("stops at once on a bad token", async () => {
      fetchMock.mockResolvedValue(json(401, { error: "unauthorized" }));
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
      expect(result).toEqual({ kind: "error", code: "unauthorized", status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSites", () => {
    it("returns the list, cached for 300 seconds", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("sites.json")));
      expect(await getSites()).toEqual(fixture("sites.json").sites);
      expect(calledUrl().pathname).toBe("/api/pap/v1/sites");
      expect([...calledUrl().searchParams.keys()]).toEqual([]);
      expect(calledInit().next).toEqual({ revalidate: 300 });
      expect(new Headers(calledInit().headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("leaves out an entry whose domain is not a plain domain", async () => {
      const good = { domain: "example.com", first_seen: "2026-10-10T00:00:00Z", last_seen: "2026-10-10T00:00:00Z" };
      fetchMock.mockResolvedValue(json(200, { sites: [good, { ...good, domain: "evil.com/x" }] }));
      expect(await getSites()).toEqual([good]);
    });

    it("answers null for a 401, a missing field or a 500 after one retry", async () => {
      fetchMock.mockResolvedValueOnce(json(401, { error: "unauthorized" }));
      expect(await getSites()).toBeNull();
      fetchMock.mockResolvedValueOnce(json(200, { sites: [{ domain: "example.com" }] }));
      expect(await getSites()).toBeNull();
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => json(500, { error: "internal_error" }));
      expect(await getSites()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("getCatalog", () => {
    it("returns the catalog without sending the token, cached for an hour", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("catalog.json")));
      const catalog = await getCatalog();
      expect(catalog?.rows).toHaveLength(100);
      expect(calledUrl().pathname).toBe("/pap/catalog.json");
      expect(new Headers(calledInit().headers).has("authorization")).toBe(false);
      expect(calledInit().next).toEqual({ revalidate: 3600 });
    });

    it("answers null for a catalog with a broken row", async () => {
      const body = fixture("catalog.json");
      (body.rows as Array<Record<string, unknown>>)[0] = { id: "T0-01" };
      fetchMock.mockResolvedValue(json(200, body));
      expect(await getCatalog()).toBeNull();
    });
  });

  describe("checkToken", () => {
    it("says bad_token for a 401 and ok for anything else", async () => {
      fetchMock.mockResolvedValueOnce(json(401, { error: "unauthorized" }));
      expect(await checkToken()).toEqual({ kind: "bad_token", code: "unauthorized" });
      fetchMock.mockResolvedValueOnce(json(404, { error: "not_scanned" }));
      expect(await checkToken()).toEqual({ kind: "ok", status: 404 });
      fetchMock.mockResolvedValueOnce(json(200, fixture("summary-not-set-up.json")));
      expect(await checkToken()).toEqual({ kind: "ok", status: 200 });
      expect(calledUrl(2).pathname).toBe("/api/pap/v1/summary");
      expect(calledInit(2).cache).toBe("no-store");
    });

    it("says no_token when the token is unset", async () => {
      vi.stubEnv("ORA_SERVICE_TOKEN", "replace-me");
      expect(await checkToken()).toEqual({ kind: "bad_token", code: "no_token" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("streamScan", () => {
    const COMPLETE = JSON.stringify({ type: "scan_complete", result: { secret: "general scan" }, timestamp: 2 });

    it("sends only domain and activeProbes, with the token, and relays clean frames", async () => {
      fetchMock.mockResolvedValue(
        sse([
          JSON.stringify({ type: "kind_detecting", timestamp: 1 }),
          JSON.stringify({ type: "scan_init", checkRoster: [{ id: "x" }], totalChecks: 105, timestamp: 1 }),
          JSON.stringify({ type: "brand_new", timestamp: 1 }),
          COMPLETE,
        ]),
      );
      const result = await streamScan("www.example.com");
      expect(result.kind === "ok" && result.ageSeconds).toBeNull();
      const frames = parseSseFrames(await readAll(result));
      expect(frames).toEqual([
        { type: "kind_detecting", timestamp: 1 },
        { type: "scan_init", totalChecks: 105, timestamp: 1 },
        { type: "scan_complete", timestamp: 2 },
      ]);
      const url = calledUrl();
      expect(url.origin + url.pathname).toBe(`${BASE}/api/scan/stream`);
      expect([...url.searchParams.entries()]).toEqual([
        ["domain", "example.com"],
        ["activeProbes", "1"],
      ]);
      expect(new Headers(calledInit().headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(calledInit().cache).toBe("no-store");
    });

    it("reads on after scan_complete until the stream closes", async () => {
      fetchMock.mockResolvedValue(
        sse([COMPLETE, JSON.stringify({ type: "error", message: "TypeError: x is undefined at db.ts:42" })]),
      );
      const text = await readAll(await streamScan("example.com"));
      expect(parseSseFrames(text)).toEqual([
        { type: "scan_complete", timestamp: 2 },
        { type: "error", reason: "failed", after_complete: true },
      ]);
      // The error's own text reaches the server log only.
      expect(text).not.toContain("db.ts");
      expect(JSON.stringify(warn.mock.calls)).toContain("db.ts:42");
    });

    it("names the unreachable error and nothing else", async () => {
      fetchMock.mockResolvedValue(sse([JSON.stringify({ type: "error", message: "Domain is not reachable" })]));
      const frames = parseSseFrames(await readAll(await streamScan("example.com")));
      expect(frames).toEqual([{ type: "error", reason: "unreachable", after_complete: false }]);
    });

    it("handles frames split across chunks and CRLF line ends", async () => {
      const text = `data: ${JSON.stringify({ type: "kind_detecting", timestamp: 1 })}\r\n\r\ndata: ${COMPLETE}\r\n\r\n`;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < text.length; index += 7) controller.enqueue(encoder.encode(text.slice(index, index + 7)));
          controller.close();
        },
      });
      fetchMock.mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } }));
      expect(parseSseFrames(await readAll(await streamScan("example.com")))).toEqual([
        { type: "kind_detecting", timestamp: 1 },
        { type: "scan_complete", timestamp: 2 },
      ]);
    });

    it("reports Ora's Age header on a stored result", async () => {
      fetchMock.mockResolvedValue(
        sse(
          [
            JSON.stringify({ type: "kind_detected", kind: "domain", timestamp: 1 }),
            JSON.stringify({
              type: "scan_complete",
              result: {},
              timestamp: 1,
              servedFromCache: true,
              resultAgeSeconds: 6,
            }),
          ],
          { age: "6" },
        ),
      );
      const result = await streamScan("example.org");
      expect(result.kind === "ok" && result.ageSeconds).toBe(6);
      expect(parseSseFrames(await readAll(result)).at(-1)).toEqual({
        type: "scan_complete",
        servedFromCache: true,
        resultAgeSeconds: 6,
        timestamp: 1,
      });
    });

    it("answers the burst 429 (plain text) as busy", async () => {
      fetchMock.mockResolvedValue(new Response("Too many requests", { status: 429, headers: { "retry-after": "30" } }));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "busy", status: 429, retryAfterSeconds: 30 });
    });

    it("answers the daily 429 (JSON) as busy", async () => {
      fetchMock.mockResolvedValue(json(429, { error: "daily_limit", retry_after_ms: 3_600_500 }));
      expect(await streamScan("example.com")).toEqual({
        kind: "error",
        code: "busy",
        status: 429,
        retryAfterSeconds: 3601,
      });
      fetchMock.mockResolvedValue(json(429, { error: "daily_limit", retry_after_ms: 9_000 }, { "retry-after": "8" }));
      expect(await streamScan("example.com")).toMatchObject({ code: "busy", retryAfterSeconds: 8 });
    });

    it("answers the service key's daily cap as busy, with when to retry, and warns once", async () => {
      // From Ora's change set dated 2026-10-11 (ORA_API.md, Limits); not yet captured live.
      fetchMock.mockResolvedValue(json(429, { error: "key_daily_cap", retry_after_ms: 7_200_000 }, { "retry-after": "7200" }));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "busy", status: 429, retryAfterSeconds: 7200 });
      fetchMock.mockResolvedValue(json(429, { error: "key_daily_cap", retry_after_ms: 59_001 }));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "busy", status: 429, retryAfterSeconds: 60 });
      const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("daily cap"));
      expect(lines).toHaveLength(1);
    });

    it("answers a 403 force_not_allowed as upstream, and warns once", async () => {
      fetchMock.mockResolvedValue(json(403, { error: "force_not_allowed" }));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "upstream", status: 403 });
      await streamScan("example.com");
      const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("force or fresh"));
      expect(lines).toHaveLength(1);
      // poppy.ax itself never asks for one.
      for (const [input] of fetchMock.mock.calls) {
        const url = new URL(String(input));
        expect(url.searchParams.has("force")).toBe(false);
        expect(url.searchParams.has("fresh")).toBe(false);
      }
    });

    it("answers other statuses and a non-stream 200 as errors", async () => {
      fetchMock.mockResolvedValueOnce(new Response("Missing domain parameter", { status: 400 }));
      expect(await streamScan("example.com")).toEqual({ kind: "invalid", code: "invalid_domain" });
      fetchMock.mockResolvedValueOnce(json(401, { error: "unauthorized" }));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "unauthorized", status: 401 });
      fetchMock.mockResolvedValueOnce(json(500, { error: "internal_error" }));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "upstream", status: 500 });
      fetchMock.mockResolvedValueOnce(json(200, {}));
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "bad_response", status: 200 });
    });

    it("gives up when Ora does not answer in time", async () => {
      fetchMock.mockImplementation(hangingFetch());
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "timeout" });
    });

    it("passes the caller's abort to Ora, after the stream has started", async () => {
      let upstreamCancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "kind_detecting" })}\n\n`));
        },
        cancel() {
          upstreamCancelled = true;
        },
      });
      fetchMock.mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } }));
      const controller = new AbortController();
      const result = await streamScan("example.com", controller.signal);
      const signal = calledInit().signal;
      expect(signal?.aborted).toBe(false);
      // The connect timeout no longer applies once Ora has answered.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(signal?.aborted).toBe(false);
      controller.abort();
      expect(signal?.aborted).toBe(true);
      if (result.kind !== "ok") throw new Error("expected a stream");
      await result.body.cancel();
      // Cancelling travels up the pipe to Ora's body a tick later.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(upstreamCancelled).toBe(true);
    });

    it("refuses an invalid domain without calling Ora", async () => {
      expect(await streamScan("example.com:8443")).toEqual({ kind: "invalid", code: "has_port" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("never sends force, fresh or maxAgeSeconds", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/scan/stream") return sse([JSON.stringify({ type: "kind_detecting" })]);
      if (path === "/pap/catalog.json") return json(200, fixture("catalog.json"));
      if (path === "/api/pap/v1/sites") return json(200, fixture("sites.json"));
      return json(200, fixture("summary-not-set-up.json"));
    });
    await getSummary("example.com");
    await getSummary("example.com", { fresh: true });
    await pollFreshSummary("example.com", { streamStartedAt: 0, wasCacheHit: false });
    await getSites();
    await getCatalog();
    await checkToken();
    await readAll(await streamScan("example.com"));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(7);
    for (const [input] of fetchMock.mock.calls) {
      const url = String(input);
      expect(url).not.toMatch(/force|fresh|maxAgeSeconds/i);
    }
  });
});

/** A byte stream from string chunks, which notes when it is cancelled. */
function chunked(parts: Array<string | Uint8Array>, options: { close?: boolean } = {}) {
  const state = { cancelled: false };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === "string" ? encoder.encode(part) : part);
      if (options.close !== false) controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

async function relayText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(relayScanEvents(stream, { domain: "example.com" })).text();
}

describe("relayScanEvents", () => {
  const DATA = (frame: object) => `data: ${JSON.stringify(frame)}`;

  it("reads a multibyte character split across chunks", async () => {
    const bytes = new TextEncoder().encode(`${DATA({ type: "check_complete", details: "café ✓ 😀" })}\n\n`);
    const at = bytes.indexOf(0xf0) + 2;
    const { stream } = chunked([bytes.slice(0, at), bytes.slice(at)]);
    expect(parseSseFrames(await relayText(stream))).toEqual([{ type: "check_complete", details: "café ✓ 😀" }]);
  });

  it("skips comment lines and joins multi-line data", async () => {
    const text = `: keep-alive\n\n${": note\n"}data: {"type":\ndata: "kind_detecting", "timestamp": 1}\n\n`;
    const { stream } = chunked([text]);
    expect(parseSseFrames(await relayText(stream))).toEqual([{ type: "kind_detecting", timestamp: 1 }]);
  });

  it("reads LF, CRLF and bare CR line ends, even when a CRLF is split", async () => {
    const one = DATA({ type: "kind_detecting", timestamp: 1 });
    const two = DATA({ type: "kind_detected", kind: "domain", timestamp: 2 });
    const three = DATA({ type: "layer_complete", layerId: "a", timestamp: 3 });
    const { stream } = chunked([`${one}\r\r`, `${two}\r`, `\n\r\n${three}\n\n`]);
    expect(parseSseFrames(await relayText(stream))).toEqual([
      { type: "kind_detecting", timestamp: 1 },
      { type: "kind_detected", kind: "domain", timestamp: 2 },
      { type: "layer_complete", layerId: "a", timestamp: 3 },
    ]);
  });

  it("keeps one frame whole when its CRLF is split between chunks", async () => {
    const { stream } = chunked(['data: {"type":\r', '\ndata: "kind_detecting"}\r\n\r\n']);
    expect(parseSseFrames(await relayText(stream))).toEqual([{ type: "kind_detecting" }]);
  });

  it("reads a frame that arrives one character at a time", async () => {
    const text = `${DATA({ type: "kind_detecting", timestamp: 1 })}\n\n${DATA({ type: "scan_complete", timestamp: 2 })}\n\n`;
    const { stream } = chunked([...text]);
    expect(parseSseFrames(await relayText(stream))).toHaveLength(2);
  });

  it("cuts a frame that grows past the cap, cancels Ora and logs it", async () => {
    const log = vi.fn();
    // 14 characters but 22 bytes: only a byte count catches it under a 20 byte cap.
    const { stream, state } = chunked(["data: ", "éééééééé"], { close: false });
    const relay = relayScanEvents(stream, { domain: "example.com", log, maxFrameBytes: 20 });
    await expect(new Response(relay).text()).rejects.toThrow(/grew past 20 bytes/);
    expect(state.cancelled).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps a frame at the cap", async () => {
    const frame = `${DATA({ type: "kind_detecting" })}\n\n`;
    const { stream } = chunked([frame]);
    const relay = relayScanEvents(stream, { domain: "example.com", maxFrameBytes: frame.length });
    expect(parseSseFrames(await new Response(relay).text())).toEqual([{ type: "kind_detecting" }]);
  });

  it("cuts a stream that sends nothing for the idle time", async () => {
    const log = vi.fn();
    const { stream, state } = chunked([`${DATA({ type: "kind_detecting" })}\n\n`], { close: false });
    const relay = relayScanEvents(stream, { domain: "example.com", log, idleTimeoutMs: 20 });
    await expect(new Response(relay).text()).rejects.toThrow(/sent nothing for 20 ms/);
    expect(state.cancelled).toBe(true);
  });

  it("parses bare CR in parseSseFrames too", () => {
    expect(parseSseFrames('data: {"type":"a"}\r\rdata: {"type":"b"}\r\r')).toEqual([{ type: "a" }, { type: "b" }]);
  });
});

describe("fix round 1, network mode", () => {
  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "0");
    vi.stubEnv("ORA_BASE_URL", BASE);
    vi.stubEnv("ORA_SERVICE_TOKEN", TOKEN);
    vi.stubEnv("VERCEL_ENV", "");
  });

  describe("checkToken", () => {
    it.each([200, 400, 404])("says ok for a %i", async (status) => {
      fetchMock.mockResolvedValue(json(status, status === 200 ? fixture("summary-not-set-up.json") : { error: "x" }));
      expect(await checkToken()).toEqual({ kind: "ok", status });
    });

    it("says bad_token for a 401", async () => {
      fetchMock.mockResolvedValue(json(401, { error: "unauthorized" }));
      expect(await checkToken()).toEqual({ kind: "bad_token", code: "unauthorized" });
    });

    it("says unknown for a timeout, a network error, a 429 and a 5xx", async () => {
      fetchMock.mockImplementationOnce(hangingFetch());
      expect(await checkToken()).toEqual({ kind: "unknown", code: "timeout" });
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      expect(await checkToken()).toEqual({ kind: "unknown", code: "network" });
      fetchMock.mockResolvedValueOnce(json(429, { error: "busy" }));
      expect(await checkToken()).toEqual({ kind: "unknown", code: "busy", status: 429 });
      fetchMock.mockResolvedValueOnce(json(500, { error: "internal_error" }));
      expect(await checkToken()).toEqual({ kind: "unknown", code: "upstream", status: 500 });
      fetchMock.mockResolvedValueOnce(json(403, {}));
      expect(await checkToken()).toEqual({ kind: "unknown", code: "upstream", status: 403 });
      // No retry inside a token check.
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it("says bad_config for a base URL it will not call", async () => {
      vi.stubEnv("ORA_BASE_URL", "ftp://ora.test");
      expect(await checkToken()).toEqual({ kind: "bad_config" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("base URL", () => {
    it("refuses plain http to a public host in production", async () => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("ORA_BASE_URL", "http://ora.test");
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "bad_config" });
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "bad_config" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["a loopback host in production", "production", "http://127.0.0.1:4214"],
      ["localhost in production", "production", "http://localhost:4214"],
      ["a public host outside production", "preview", "http://ora.test"],
    ])("allows plain http to %s", async (_name, env, base) => {
      vi.stubEnv("VERCEL_ENV", env);
      vi.stubEnv("ORA_BASE_URL", base);
      fetchMock.mockResolvedValue(json(404, { error: "not_scanned" }));
      expect(await getSummary("example.com")).toEqual({ kind: "not_scanned" });
      expect(calledUrl().origin).toBe(new URL(base).origin);
    });
  });

  it("refuses fixture mode in production, says so once, and calls nothing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ORA_FIXTURES", "1");
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await getSummary("example.com")).toEqual({ kind: "error", code: "bad_config" });
      expect(await pollFreshSummary("example.com", { streamStartedAt: 0, wasCacheHit: false })).toEqual({
        kind: "error",
        code: "bad_config",
      });
      expect(await getSites()).toBeNull();
      expect(await getCatalog()).toBeNull();
      expect(await streamScan("example.com")).toEqual({ kind: "error", code: "bad_config" });
      expect(await checkToken()).toEqual({ kind: "bad_config" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledTimes(1);
    } finally {
      logError.mockRestore();
    }
  });

  it("refuses redirects on every call that carries the token", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/scan/stream") return sse([JSON.stringify({ type: "kind_detecting" })]);
      if (path === "/pap/catalog.json") return json(200, fixture("catalog.json"));
      if (path === "/api/pap/v1/sites") return json(200, fixture("sites.json"));
      return json(200, fixture("summary-not-set-up.json"));
    });
    await getSummary("example.com");
    await getSites();
    await checkToken();
    await readAll(await streamScan("example.com"));
    await getCatalog();
    for (const [input, init] of fetchMock.mock.calls) {
      const authed = new Headers(init?.headers).has("authorization");
      expect(init?.redirect, String(input)).toBe(authed ? "error" : undefined);
    }
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).has("authorization")).toBe(false);
  });

  it("tags the cached summary so a route can revalidate it", async () => {
    expect(summaryTag("https://www.Example.com/")).toBe("ora-summary:example.com");
    fetchMock.mockResolvedValue(json(200, fixture("summary-not-set-up.json")));
    await getSummary("www.example.com");
    expect(calledInit().next).toEqual({ revalidate: 60, tags: [summaryTag("example.com")] });
  });

  it("warns once, naming it, about a 400 code it does not know", async () => {
    fetchMock.mockResolvedValue(json(400, { error: "something_new" }));
    await getSummary("example.com");
    await getSummary("example.com");
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("something_new"));
    expect(lines).toHaveLength(1);
  });

  it("warns once, without failing, when Ora answers for another domain", async () => {
    fetchMock.mockResolvedValue(json(200, { ...fixture("summary-not-set-up.json"), domain: "other.example.com" }));
    const result = await getSummary("example.com");
    expect(result.kind === "ok" && result.summary.domain).toBe("other.example.com");
    await getSummary("example.com");
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("other.example.com"));
    expect(lines).toHaveLength(1);
  });

  it("reads Retry-After given as an HTTP date", async () => {
    const at = new Date(Date.now() + 120_000).toUTCString();
    fetchMock.mockResolvedValue(json(429, { error: "busy" }, { "retry-after": at }));
    const result = await getSummary("example.com");
    expect(result).toMatchObject({ kind: "error", code: "busy", status: 429 });
    const seconds = result.kind === "error" ? (result.retryAfterSeconds ?? 0) : 0;
    expect(seconds).toBeGreaterThanOrEqual(118);
    expect(seconds).toBeLessThanOrEqual(120);
  });

  describe("streamScan freshness inputs", () => {
    it("takes startedAt from Ora's Date header", async () => {
      const date = "Sun, 11 Oct 2026 10:00:00 GMT";
      fetchMock.mockResolvedValue(sse([JSON.stringify({ type: "scan_complete", timestamp: 1 })], { date }));
      const result = await streamScan("example.com");
      expect(result.kind === "ok" && result.startedAt).toBe(Date.parse(date));
    });

    it("falls back to the time just before the request", async () => {
      fetchMock.mockResolvedValue(sse([JSON.stringify({ type: "scan_complete", timestamp: 1 })]));
      const before = Date.now();
      const result = await streamScan("example.com");
      const after = Date.now();
      if (result.kind !== "ok") throw new Error("expected a stream");
      expect(result.startedAt).toBeGreaterThanOrEqual(before);
      expect(result.startedAt).toBeLessThanOrEqual(after);
    });

    it.each([
      ["a fresh scan", {}, { type: "scan_complete", result: {}, timestamp: 1 }, false],
      ["an Age header", { age: "6" }, { type: "scan_complete", result: {}, timestamp: 1 }, true],
      ["a servedFromCache frame", {}, { type: "scan_complete", result: {}, timestamp: 1, servedFromCache: true }, true],
    ])("settles servedFromCache from %s", async (_name, headers, frame, expected) => {
      fetchMock.mockResolvedValue(sse([JSON.stringify(frame)], headers as Record<string, string>));
      const result = await streamScan("example.com");
      if (result.kind !== "ok") throw new Error("expected a stream");
      await readAll(result);
      expect(await result.servedFromCache).toBe(expected);
    });

    it("settles servedFromCache when the stream ends without scan_complete, or is cancelled", async () => {
      fetchMock.mockResolvedValueOnce(sse([JSON.stringify({ type: "error", message: "Domain is not reachable" })]));
      const ended = await streamScan("example.com");
      if (ended.kind !== "ok") throw new Error("expected a stream");
      await readAll(ended);
      expect(await ended.servedFromCache).toBe(false);

      fetchMock.mockResolvedValueOnce(sse([JSON.stringify({ type: "kind_detecting" })]));
      const cancelled = await streamScan("example.com");
      if (cancelled.kind !== "ok") throw new Error("expected a stream");
      await cancelled.body.cancel();
      expect(await cancelled.servedFromCache).toBe(false);
    });
  });

  it("says aborted when the caller aborts while connecting", async () => {
    configureOraClient({ connectTimeoutMs: 5_000 });
    fetchMock.mockImplementation(hangingFetch());
    const controller = new AbortController();
    const pending = streamScan("example.com", controller.signal);
    controller.abort();
    expect(await pending).toEqual({ kind: "error", code: "aborted" });
  });

  it("cuts the stream when Ora goes quiet", async () => {
    configureOraClient({ streamIdleTimeoutMs: 20 });
    const { stream, state } = chunked([`data: ${JSON.stringify({ type: "kind_detecting" })}\n\n`], { close: false });
    fetchMock.mockResolvedValue(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    const result = await streamScan("example.com");
    await expect(readAll(result)).rejects.toThrow(/sent nothing/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.cancelled).toBe(true);
  });

  it("gives up reading a 429 body that never ends", async () => {
    const { stream } = chunked(['{"error":'], { close: false });
    fetchMock.mockResolvedValue(new Response(stream, { status: 429, headers: { "retry-after": "5" } }));
    const started = Date.now();
    expect(await streamScan("example.com")).toEqual({ kind: "error", code: "busy", status: 429, retryAfterSeconds: 5 });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  describe("pollFreshSummary", () => {
    const old = () => json(200, { ...fixture("summary-not-set-up.json"), last_run: "2026-10-10T00:00:00.000Z" });

    it("keeps the stale result when an error comes in between", async () => {
      configureOraClient({ pollBudgetMs: 40, pollIntervalMs: 5 });
      fetchMock.mockResolvedValueOnce(old());
      fetchMock.mockImplementation(async () => json(500, { error: "internal_error" }));
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
      expect(result.kind).toBe("stale");
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });

    it("stops at once with busy on a 429", async () => {
      fetchMock.mockResolvedValue(json(429, { error: "busy", retry_after_ms: 4_000 }));
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
      expect(result).toEqual({ kind: "error", code: "busy", status: 429, retryAfterSeconds: 4 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry a 5xx inside a try", async () => {
      // A retry would wait 10 seconds and time the test out.
      configureOraClient({ retryDelayMs: 10_000, pollBudgetMs: 30, pollIntervalMs: 5 });
      fetchMock.mockImplementation(async () => json(500, { error: "internal_error" }));
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
      expect(result).toEqual({ kind: "error", code: "upstream", status: 500 });
    });

    it("cuts a slow try off at the end of the budget", async () => {
      configureOraClient({ requestTimeoutMs: 5_000, pollBudgetMs: 40 });
      fetchMock.mockImplementation(hangingFetch());
      const started = Date.now();
      const result = await pollFreshSummary("example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
      expect(result).toEqual({ kind: "error", code: "timeout" });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("fix round 1, fixture mode", () => {
  beforeEach(() => {
    vi.stubEnv("ORA_FIXTURES", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    fetchMock.mockImplementation(() => {
      throw new Error("fixture mode must not call the network");
    });
  });

  it("asks once when polling", async () => {
    const result = await pollFreshSummary("failing-p0.example.com", { streamStartedAt: Date.now(), wasCacheHit: false });
    expect(result.kind === "ok" && result.summary.verdict).toBe("problems");
    expect(await pollFreshSummary("unknown.example.net", { streamStartedAt: 0, wasCacheHit: false })).toEqual({
      kind: "not_scanned",
    });
  });

  it("gives the replay a start time and settles servedFromCache to false", async () => {
    const before = Date.now();
    const result = await streamScan("example.com");
    if (result.kind !== "ok") throw new Error("expected a stream");
    expect(result.startedAt).toBeGreaterThanOrEqual(before);
    const frames = parseSseFrames(await readAll(result));
    expect(frames.at(-1)).toMatchObject({ type: "scan_complete" });
    expect(await result.servedFromCache).toBe(false);
  });

  it("reads an empty ORA_FIXTURES_DELAY_MS as unset (30 ms between frames)", async () => {
    configureOraClient({ fixtureFrameDelayMs: null });
    vi.stubEnv("ORA_FIXTURES_DELAY_MS", "");
    const result = await streamScan("example.com");
    if (result.kind !== "ok") throw new Error("expected a stream");
    const reader = result.body.getReader();
    const started = Date.now();
    await reader.read();
    await reader.read();
    await reader.read();
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    await reader.cancel();
  });
});
