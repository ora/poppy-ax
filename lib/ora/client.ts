import "server-only";
import { setTimeout as sleep } from "node:timers/promises";
import { normalizeDomain, type DomainError } from "@/lib/domain";
import {
  fixtureCatalog,
  fixtureInvalid,
  fixtureScanStream,
  fixtureSites,
  fixtureSummary,
  fixturesEnabled,
} from "@/lib/ora/fixtures";
import { parseCatalog, parseSites, parseSummary } from "@/lib/ora/guards";
import { relayScanEvents } from "@/lib/ora/sse";
import {
  INVALID_DOMAIN_CODES,
  type Catalog,
  type FreshSummaryResult,
  type InvalidDomainCode,
  type OraError,
  type OraErrorCode,
  type ScanStreamResult,
  type Site,
  type Summary,
  type SummaryResult,
  type TokenCheck,
} from "@/lib/ora/types";

// The only module that talks to Ora. ORA_API.md is the contract. Every call
// runs on the server, never throws on an HTTP, JSON or network problem, and
// returns a result the page can branch on. With ORA_FIXTURES=1 it reads
// fixtures/ instead (lib/ora/fixtures.ts).

export interface OraClientConfig {
  /** Per attempt, for the summary, the sites list and the catalog. */
  requestTimeoutMs: number;
  /** For the scan stream: until Ora answers with its headers. */
  connectTimeoutMs: number;
  /** Wait before the one retry after a 5xx from the summary or sites list. */
  retryDelayMs: number;
  /** Fixed wait between summary polls after a scan. */
  pollIntervalMs: number;
  /** Total time to wait for a scan's summary. */
  pollBudgetMs: number;
  /** Gap between replayed frames in fixture mode. Null reads ORA_FIXTURES_DELAY_MS, else 30. */
  fixtureFrameDelayMs: number | null;
}

const DEFAULT_CONFIG: OraClientConfig = {
  requestTimeoutMs: 8_000,
  connectTimeoutMs: 15_000,
  retryDelayMs: 2_000,
  pollIntervalMs: 1_500,
  pollBudgetMs: 30_000,
  fixtureFrameDelayMs: null,
};

let config: OraClientConfig = { ...DEFAULT_CONFIG };
const logged = new Set<string>();

/** Change timings, for tests. */
export function configureOraClient(changes: Partial<OraClientConfig>): void {
  config = { ...config, ...changes };
}

/** Back to the default timings, and forget which warnings were logged. */
export function resetOraClient(): void {
  config = { ...DEFAULT_CONFIG };
  logged.clear();
}

function warnOnce(key: string, message: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(`[ora] ${message}`);
}

/** Summary freshness: a summary saved this long before the stream began still counts. */
const FRESHNESS_SLACK_MS = 5_000;

/**
 * Whether a summary comes from the scan that started at `streamStartedAt`
 * (Unix ms). While a new scan runs, Ora answers with the domain's previous
 * result, so a summary only counts once its `last_run` is no earlier than 5
 * seconds before the stream began, or when the stream served a stored result.
 */
export function isFreshSummary(summary: Pick<Summary, "last_run">, streamStartedAt: number, wasCacheHit: boolean): boolean {
  if (wasCacheHit) return true;
  const lastRun = Date.parse(summary.last_run);
  return Number.isFinite(lastRun) && lastRun >= streamStartedAt - FRESHNESS_SLACK_MS;
}

// ---- Settings ----------------------------------------------------------------

const DEFAULT_BASE_URL = "https://ora.ai";
const PLACEHOLDER_TOKEN = "replace-me";

function baseUrl(): URL | null {
  const raw = process.env.ORA_BASE_URL?.trim() || DEFAULT_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:") return url;
  } catch {
    // Reported below.
  }
  warnOnce("base_url", "ORA_BASE_URL is not an http(s) URL; not calling Ora.");
  return null;
}

/** The service token, or null when it is unset or still the placeholder. */
function serviceToken(): string | null {
  const token = process.env.ORA_SERVICE_TOKEN?.trim();
  if (!token || token === PLACEHOLDER_TOKEN) {
    warnOnce("token", "ORA_SERVICE_TOKEN is not set; not calling Ora. Set it, or set ORA_FIXTURES=1.");
    return null;
  }
  return token;
}

function fixtureDelayMs(): number {
  if (config.fixtureFrameDelayMs !== null) return config.fixtureFrameDelayMs;
  const fromEnv = Number(process.env.ORA_FIXTURES_DELAY_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 30;
}

const DOMAIN_ERROR_CODES: Readonly<Record<DomainError, InvalidDomainCode>> = {
  empty: "invalid_domain",
  invalid: "invalid_domain",
  ip_address: "ip_address",
  localhost: "localhost",
  has_port: "has_port",
  has_path: "has_path",
};

type CheckedDomain = { ok: true; domain: string } | { ok: false; code: InvalidDomainCode };

/** The host to ask Ora about, by lib/domain.ts, or the code Ora would answer. */
function checkDomain(input: string): CheckedDomain {
  const result = normalizeDomain(input);
  return result.ok ? { ok: true, domain: result.domain } : { ok: false, code: DOMAIN_ERROR_CODES[result.error] };
}

function invalidCode(value: unknown): InvalidDomainCode {
  return (INVALID_DOMAIN_CODES as readonly unknown[]).includes(value) ? (value as InvalidDomainCode) : "invalid_domain";
}

// ---- Requests ---------------------------------------------------------------

type Caching = { cache: "no-store" } | { revalidate: number };

interface RequestOptions {
  params?: Record<string, string>;
  /** Send the service token. The catalog is public and goes without it. */
  auth: boolean;
  caching: Caching;
  /** Retry once after a 5xx. */
  retry: boolean;
  signal?: AbortSignal;
}

interface Answer {
  kind: "answer";
  status: number;
  /** The parsed JSON body, or undefined when it was not JSON. */
  json: unknown;
  retryAfterSeconds: number | undefined;
}

function error(code: OraErrorCode, status?: number, retryAfterSeconds?: number): OraError {
  return {
    kind: "error",
    code,
    ...(status === undefined ? {} : { status }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

/** Seconds from a Retry-After header (seconds or an HTTP date), or a JSON `retry_after_ms`. */
function retryAfter(headers: Headers, json: unknown): number | undefined {
  const header = headers.get("retry-after")?.trim();
  if (header) {
    if (/^\d+$/.test(header)) return Number(header);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  if (typeof json === "object" && json !== null) {
    const ms = (json as { retry_after_ms?: unknown }).retry_after_ms;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) return Math.ceil(ms / 1000);
  }
  return undefined;
}

function failure(caught: unknown, signal: AbortSignal | undefined): OraError {
  if (signal?.aborted) return error("aborted");
  if (caught instanceof Error && caught.name === "TimeoutError") return error("timeout");
  return error("network");
}

async function requestJson(path: string, options: RequestOptions): Promise<Answer | OraError> {
  const base = baseUrl();
  if (!base) return error("bad_config");
  const headers = new Headers({ Accept: "application/json" });
  if (options.auth) {
    const token = serviceToken();
    if (!token) return error("no_token");
    headers.set("Authorization", `Bearer ${token}`);
  }
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);

  const init: RequestInit = { method: "GET", headers };
  if ("cache" in options.caching) {
    // Right after a scan: skip every cache between here and Ora's database.
    init.cache = "no-store";
    headers.set("Cache-Control", "no-cache");
  } else {
    init.next = { revalidate: options.caching.revalidate };
  }

  for (let attempt = 0; ; attempt += 1) {
    const timeout = AbortSignal.timeout(config.requestTimeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let answer: Answer;
    try {
      const response = await fetch(url, { ...init, signal });
      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
      answer = { kind: "answer", status: response.status, json, retryAfterSeconds: retryAfter(response.headers, json) };
    } catch (caught) {
      return failure(caught, options.signal);
    }
    if (answer.status >= 500 && options.retry && attempt === 0) {
      try {
        await sleep(config.retryDelayMs, undefined, { signal: options.signal });
      } catch {
        return error("aborted");
      }
      continue;
    }
    return answer;
  }
}

function errorCodeOf(json: unknown): unknown {
  return typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
}

/** The common statuses of the token-protected JSON endpoints. */
function statusError(answer: Answer): OraError {
  if (answer.status === 401) return error("unauthorized", 401);
  if (answer.status === 429) return error("busy", 429, answer.retryAfterSeconds);
  return error("upstream", answer.status);
}

// ---- Endpoints ---------------------------------------------------------------

export interface SummaryOptions {
  /** Skip every cache: use right after a scan, and when polling. */
  fresh?: boolean;
  signal?: AbortSignal;
}

/**
 * The stored PAP result for one domain. The domain goes through lib/domain.ts
 * first; one it refuses is answered without calling Ora.
 *
 * Caching: a 200 is kept in Next's data cache for 60 seconds, matching Ora's
 * `max-age=60`; `fresh` bypasses it. Errors are never cached.
 */
export async function getSummary(domain: string, options: SummaryOptions = {}): Promise<SummaryResult> {
  const checked = checkDomain(domain);
  if (fixturesEnabled()) return checked.ok ? fixtureSummary(checked.domain) : fixtureInvalid(checked.code);
  if (!checked.ok) return { kind: "invalid", code: checked.code };

  const answer = await requestJson("/api/pap/v1/summary", {
    params: { domain: checked.domain },
    auth: true,
    caching: options.fresh ? { cache: "no-store" } : { revalidate: 60 },
    retry: true,
    signal: options.signal,
  });
  if (answer.kind === "error") return answer;

  if (answer.status === 200) {
    const summary = parseSummary(answer.json);
    if (summary) return { kind: "ok", summary };
    warnOnce("summary_shape", "summary answer does not match ORA_API.md");
    return error("bad_response", 200);
  }
  if (answer.status === 404 && errorCodeOf(answer.json) === "not_scanned") return { kind: "not_scanned" };
  if (answer.status === 400) return { kind: "invalid", code: invalidCode(errorCodeOf(answer.json)) };
  return statusError(answer);
}

export interface PollOptions {
  /** When the scan stream was opened, in Unix ms. */
  streamStartedAt: number;
  /** True when the stream served a stored result (an `Age` header or `servedFromCache`). */
  wasCacheHit: boolean;
  signal?: AbortSignal;
}

/** Errors that will not clear up by asking again. */
const FINAL_ERRORS: ReadonlySet<OraErrorCode> = new Set(["no_token", "bad_config", "unauthorized", "aborted"]);

/**
 * Wait for the summary of the scan that just ran: ask at a fixed short
 * interval, without caches, for about 30 seconds in all, until the answer is
 * fresh (see isFreshSummary). Ora answers `not_scanned`, or the previous
 * result, while the scan is still saving. When time runs out on a previous
 * result, answers `stale` with it. In fixture mode every summary is fresh.
 */
export async function pollFreshSummary(domain: string, options: PollOptions): Promise<FreshSummaryResult> {
  const deadline = Date.now() + config.pollBudgetMs;
  let last: FreshSummaryResult = { kind: "not_scanned" };
  for (;;) {
    const result = await getSummary(domain, { fresh: true, signal: options.signal });
    if (result.kind === "ok") {
      if (fixturesEnabled() || isFreshSummary(result.summary, options.streamStartedAt, options.wasCacheHit)) {
        return result;
      }
      last = { kind: "stale", summary: result.summary };
    } else if (result.kind === "invalid" || (result.kind === "error" && FINAL_ERRORS.has(result.code))) {
      return result;
    } else if (!(result.kind === "error" && last.kind === "stale")) {
      // Keep a previous result over a passing error, so the page has something to show.
      last = result;
    }
    if (Date.now() + config.pollIntervalMs > deadline) return last;
    try {
      await sleep(config.pollIntervalMs, undefined, { signal: options.signal });
    } catch {
      return error("aborted");
    }
  }
}

/**
 * Every domain Ora has seen publishing PAP, or null when Ora gave no usable
 * answer. Cached for 300 seconds, matching Ora's `max-age=300`.
 */
export async function getSites(): Promise<Site[] | null> {
  if (fixturesEnabled()) return fixtureSites();
  const answer = await requestJson("/api/pap/v1/sites", { auth: true, caching: { revalidate: 300 }, retry: true });
  if (answer.kind === "error") {
    warnOnce(`sites_${answer.code}`, `sites list unavailable (${answer.code})`);
    return null;
  }
  if (answer.status !== 200) {
    warnOnce(`sites_${answer.status}`, `sites list answered ${answer.status}`);
    return null;
  }
  const sites = parseSites(answer.json);
  if (!sites) warnOnce("sites_shape", "sites answer does not match ORA_API.md");
  return sites;
}

/**
 * The check catalog, or null when Ora gave no usable answer. Public, so it
 * goes without the token. Cached for an hour, matching Ora's `max-age=3600`.
 */
export async function getCatalog(): Promise<Catalog | null> {
  if (fixturesEnabled()) return fixtureCatalog();
  const answer = await requestJson("/pap/catalog.json", { auth: false, caching: { revalidate: 3600 }, retry: false });
  if (answer.kind === "error" || answer.status !== 200) {
    warnOnce("catalog", "catalog unavailable");
    return null;
  }
  const catalog = parseCatalog(answer.json);
  if (!catalog) warnOnce("catalog_shape", "catalog answer does not match ORA_API.md");
  return catalog;
}

/**
 * Whether Ora accepts the service token. Ora's scan stream never answers
 * 401: a missing or unknown token quietly makes poppy.ax an anonymous caller
 * with low limits. So this asks for a summary instead, where a 401 means the
 * token is bad and any other answer means it is accepted.
 */
export async function checkToken(): Promise<TokenCheck> {
  if (fixturesEnabled()) return { kind: "ok" };
  const answer = await requestJson("/api/pap/v1/summary", {
    params: { domain: "example.com" },
    auth: true,
    caching: { cache: "no-store" },
    retry: false,
  });
  if (answer.kind === "error") {
    if (answer.code === "no_token") return { kind: "bad_token", code: "no_token" };
    return { kind: "ok" };
  }
  if (answer.status === 401) return { kind: "bad_token", code: "unauthorized" };
  return { kind: "ok", status: answer.status };
}

/**
 * Start a check of `domain` (or get Ora's stored one) and follow it. Returns
 * the progress as server-sent events cleaned for the browser, for a route to
 * relay. Read it until it closes: the result may be saved only after
 * `scan_complete`; then call pollFreshSummary.
 *
 * Sends only `domain` and `activeProbes=1`. Aborting `signal` aborts the
 * request to Ora, and so does cancelling the returned stream. The only
 * timeout is for Ora to answer with its headers; the stream itself has none.
 */
export async function streamScan(domain: string, signal?: AbortSignal): Promise<ScanStreamResult> {
  const checked = checkDomain(domain);
  if (!checked.ok) return { kind: "invalid", code: checked.code };

  if (fixturesEnabled()) {
    try {
      const replay = await fixtureScanStream(checked.domain, fixtureDelayMs(), signal);
      return { kind: "ok", body: relayScanEvents(replay, { domain: checked.domain }), ageSeconds: null };
    } catch (caught) {
      console.warn(`[ora] fixture scan unreadable: ${String(caught)}`);
      return error("fixture_missing");
    }
  }

  const base = baseUrl();
  if (!base) return error("bad_config");
  const token = serviceToken();
  if (!token) return error("no_token");

  const url = new URL("/api/scan/stream", base);
  url.searchParams.set("domain", checked.domain);
  url.searchParams.set("activeProbes", "1");

  const connect = new AbortController();
  const timer = setTimeout(
    () => connect.abort(new DOMException("Ora did not answer in time", "TimeoutError")),
    config.connectTimeoutMs,
  );
  const combined = signal ? AbortSignal.any([signal, connect.signal]) : connect.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: combined,
    });
  } catch (caught) {
    return failure(caught, signal);
  } finally {
    clearTimeout(timer);
  }

  const isEventStream = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
  if (response.status === 200 && isEventStream && response.body) {
    const age = Number(response.headers.get("age"));
    const ageSeconds = response.headers.has("age") && Number.isFinite(age) && age >= 0 ? age : null;
    return { kind: "ok", body: relayScanEvents(response.body, { domain: checked.domain }), ageSeconds };
  }

  // Not a stream. Only a 429 body is worth reading: the daily limit says when
  // to retry in JSON, the burst limit in plain text with only the header.
  if (response.status === 429) {
    let json: unknown;
    try {
      json = JSON.parse(await response.text()) as unknown;
    } catch {
      json = undefined;
    }
    return error("busy", 429, retryAfter(response.headers, json));
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 200) return error("bad_response", 200);
  if (response.status === 400) return { kind: "invalid", code: "invalid_domain" };
  if (response.status === 401) return error("unauthorized", 401);
  return error("upstream", response.status);
}
