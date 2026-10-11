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
import { IDLE_TIMEOUT_MS, relayScanEvents } from "@/lib/ora/sse";
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
// fixtures/ instead (lib/ora/fixtures.ts), except in Vercel production,
// where fixture mode is refused.

export interface OraClientConfig {
  /** Per attempt, for the summary, the sites list and the catalog. */
  requestTimeoutMs: number;
  /** For the scan stream: until Ora answers with its headers. */
  connectTimeoutMs: number;
  /** For the scan stream: the longest Ora may send nothing. */
  streamIdleTimeoutMs: number;
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
  streamIdleTimeoutMs: IDLE_TIMEOUT_MS,
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

/** The Next data cache tag of one domain's summary, for `revalidateTag` after a scan. */
export function summaryTag(domain: string): string {
  const result = normalizeDomain(domain);
  return `ora-summary:${result.ok ? result.domain : domain.trim().toLowerCase()}`;
}

/** Summary freshness: a summary saved this long before the stream began still counts. */
const FRESHNESS_SLACK_MS = 5_000;

/**
 * Whether a summary comes from the scan that started at `streamStartedAt`
 * (Unix ms). While a new scan runs, Ora answers with the domain's previous
 * result, so a summary only counts once its `last_run` is no earlier than 5
 * seconds before the stream began, or when the stream served a stored result.
 *
 * Its inputs come from streamScan: `streamStartedAt` is the result's
 * `startedAt`, and `wasCacheHit` is `await result.servedFromCache`.
 */
export function isFreshSummary(summary: Pick<Summary, "last_run">, streamStartedAt: number, wasCacheHit: boolean): boolean {
  if (wasCacheHit) return true;
  const lastRun = Date.parse(summary.last_run);
  return Number.isFinite(lastRun) && lastRun >= streamStartedAt - FRESHNESS_SLACK_MS;
}

// ---- Settings ----------------------------------------------------------------

const DEFAULT_BASE_URL = "https://ora.ai";
const PLACEHOLDER_TOKEN = "replace-me";

function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Where answers come from. Fixture mode is refused in Vercel production, so a
 * stray ORA_FIXTURES=1 cannot put recorded results on the live site.
 */
function mode(): "fixtures" | "network" | "refused" {
  if (!fixturesEnabled()) return "network";
  if (!isVercelProduction()) return "fixtures";
  if (!logged.has("fixtures_in_production")) {
    logged.add("fixtures_in_production");
    console.error("[ora] ORA_FIXTURES=1 is refused in production; every Ora call fails until it is unset.");
  }
  return "refused";
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/** Ora's base URL: https, or plain http for a loopback host or outside Vercel production. */
function baseUrl(): URL | null {
  const raw = process.env.ORA_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch (caught) {
    if (!(caught instanceof TypeError)) throw caught;
  }
  if (url?.protocol === "https:") return url;
  if (url?.protocol === "http:" && (isLoopback(url.hostname) || !isVercelProduction())) return url;
  warnOnce("base_url", "ORA_BASE_URL must be an https URL (http only for a loopback host outside production); not calling Ora.");
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
  const raw = process.env.ORA_FIXTURES_DELAY_MS?.trim();
  const fromEnv = raw ? Number(raw) : Number.NaN;
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
  if ((INVALID_DOMAIN_CODES as readonly unknown[]).includes(value)) return value as InvalidDomainCode;
  const name = JSON.stringify(typeof value === "string" ? value.slice(0, 64) : value ?? null);
  warnOnce(`400_${name}`, `summary answered 400 with an unknown code ${name}; read as invalid_domain`);
  return "invalid_domain";
}

// ---- Requests ---------------------------------------------------------------

type Caching = { cache: "no-store" } | { revalidate: number; tags?: string[] };

interface RequestOptions {
  params?: Record<string, string>;
  /** Send the service token. The catalog is public and goes without it. */
  auth: boolean;
  caching: Caching;
  /** Retry once after a 5xx. */
  retry: boolean;
  /** Per attempt; defaults to config.requestTimeoutMs. */
  timeoutMs?: number;
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (caught) {
    // Not JSON: the caller treats undefined as "no body it can read".
    if (!(caught instanceof SyntaxError)) throw caught;
    return undefined;
  }
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

/** A response body as text, given up on (and cancelled) after `ms`. */
async function textWithin(response: Response, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const text = await Promise.race([response.text().catch(() => ""), late]);
    if (text === null) {
      response.body?.cancel().catch(() => undefined);
      return "";
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(path: string, options: RequestOptions): Promise<Answer | OraError> {
  const base = baseUrl();
  if (!base) return error("bad_config");
  const headers = new Headers({ Accept: "application/json" });
  const init: RequestInit = { method: "GET", headers };
  if (options.auth) {
    const token = serviceToken();
    if (!token) return error("no_token");
    headers.set("Authorization", `Bearer ${token}`);
    // A redirect must not carry the token anywhere else.
    init.redirect = "error";
  }
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);

  if ("cache" in options.caching) {
    // Right after a scan: skip every cache between here and Ora's database.
    init.cache = "no-store";
    headers.set("Cache-Control", "no-cache");
  } else {
    const { revalidate, tags } = options.caching;
    init.next = tags ? { revalidate, tags } : { revalidate };
  }

  for (let attempt = 0; ; attempt += 1) {
    const timeout = AbortSignal.timeout(Math.max(1, options.timeoutMs ?? config.requestTimeoutMs));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let answer: Answer;
    try {
      const response = await fetch(url, { ...init, signal });
      const json = parseJson(await response.text());
      answer = { kind: "answer", status: response.status, json, retryAfterSeconds: retryAfter(response.headers, json) };
    } catch (caught) {
      return failure(caught, options.signal);
    }
    if (answer.status >= 500 && options.retry && attempt === 0) {
      try {
        await sleep(config.retryDelayMs, undefined, { signal: options.signal });
      } catch {
        // Only an abort interrupts the wait.
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

interface SummaryRequest extends SummaryOptions {
  retry: boolean;
  timeoutMs?: number;
}

async function requestSummary(domain: string, options: SummaryRequest): Promise<SummaryResult> {
  const checked = checkDomain(domain);
  const source = mode();
  if (source === "refused") return error("bad_config");
  if (source === "fixtures") return checked.ok ? fixtureSummary(checked.domain) : fixtureInvalid(checked.code);
  if (!checked.ok) return { kind: "invalid", code: checked.code };

  const answer = await requestJson("/api/pap/v1/summary", {
    params: { domain: checked.domain },
    auth: true,
    caching: options.fresh ? { cache: "no-store" } : { revalidate: 60, tags: [summaryTag(checked.domain)] },
    retry: options.retry,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  if (answer.kind === "error") return answer;

  if (answer.status === 200) {
    const summary = parseSummary(answer.json);
    if (!summary) {
      warnOnce("summary_shape", "summary answer does not match ORA_API.md");
      return error("bad_response", 200);
    }
    if (summary.domain !== checked.domain) {
      warnOnce("summary_domain", `asked for ${checked.domain}, Ora answered for ${summary.domain}`);
    }
    return { kind: "ok", summary };
  }
  if (answer.status === 404 && errorCodeOf(answer.json) === "not_scanned") return { kind: "not_scanned" };
  if (answer.status === 400) return { kind: "invalid", code: invalidCode(errorCodeOf(answer.json)) };
  return statusError(answer);
}

/**
 * The stored PAP result for one domain. The domain goes through lib/domain.ts
 * first; one it refuses is answered without calling Ora.
 *
 * Caching: a 200 is kept in Next's data cache for 60 seconds, matching Ora's
 * `max-age=60`, under the tag `summaryTag(domain)`; `fresh` bypasses it.
 * Errors are never cached. A 5xx is retried once after about 2 seconds.
 */
export function getSummary(domain: string, options: SummaryOptions = {}): Promise<SummaryResult> {
  return requestSummary(domain, { ...options, retry: true });
}

export interface PollOptions {
  /** When the scan began, in Unix ms: streamScan's `startedAt`. */
  streamStartedAt: number;
  /** Whether the stream served a stored result: `await` streamScan's `servedFromCache`. */
  wasCacheHit: boolean;
  signal?: AbortSignal;
}

/** Errors that will not clear up by asking again. */
const FINAL_ERRORS: ReadonlySet<OraErrorCode> = new Set(["no_token", "bad_config", "unauthorized", "aborted", "busy"]);

/**
 * Wait for the summary of the scan that just ran: ask at a fixed short
 * interval, without caches, for about 30 seconds in all, until the answer is
 * fresh (see isFreshSummary). Ora answers `not_scanned`, or the previous
 * result, while the scan is still saving. Each try is cut off when the
 * budget runs out, and a 5xx is not retried inside a try. A 429 stops the
 * wait at once with `busy`. When time runs out on a previous result, answers
 * `stale` with it. In fixture mode it asks once: every fixture is fresh.
 */
export async function pollFreshSummary(domain: string, options: PollOptions): Promise<FreshSummaryResult> {
  if (mode() !== "network") return getSummary(domain, { fresh: true, signal: options.signal });
  const deadline = Date.now() + config.pollBudgetMs;
  let last: FreshSummaryResult = { kind: "not_scanned" };
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return last;
    const result = await requestSummary(domain, {
      fresh: true,
      signal: options.signal,
      retry: false,
      timeoutMs: Math.min(config.requestTimeoutMs, remaining),
    });
    if (result.kind === "ok") {
      if (isFreshSummary(result.summary, options.streamStartedAt, options.wasCacheHit)) return result;
      last = { kind: "stale", summary: result.summary };
    } else if (result.kind === "invalid" || (result.kind === "error" && FINAL_ERRORS.has(result.code))) {
      return result;
    } else if (!(result.kind === "error" && last.kind === "stale")) {
      // Keep a previous result over a passing error, so the page has something to show.
      last = result;
    }
    if (Date.now() + config.pollIntervalMs >= deadline) return last;
    try {
      await sleep(config.pollIntervalMs, undefined, { signal: options.signal });
    } catch {
      // Only an abort interrupts the wait.
      return error("aborted");
    }
  }
}

/**
 * Every domain Ora has seen publishing PAP, or null when Ora gave no usable
 * answer. Cached for 300 seconds, matching Ora's `max-age=300`. A 5xx is
 * retried once.
 */
export async function getSites(): Promise<Site[] | null> {
  const source = mode();
  if (source === "refused") return null;
  if (source === "fixtures") return fixtureSites();
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
  const source = mode();
  if (source === "refused") return null;
  if (source === "fixtures") return fixtureCatalog();
  const answer = await requestJson("/pap/catalog.json", { auth: false, caching: { revalidate: 3600 }, retry: false });
  if (answer.kind === "error" || answer.status !== 200) {
    warnOnce("catalog", "catalog unavailable");
    return null;
  }
  const catalog = parseCatalog(answer.json);
  if (!catalog) warnOnce("catalog_shape", "catalog answer does not match ORA_API.md");
  return catalog;
}

/** Statuses that prove Ora read the token and accepted it. */
const TOKEN_ACCEPTED = new Set([200, 400, 404]);

/**
 * Whether Ora accepts the service token. Ora's scan stream never answers
 * 401: a missing or unknown token quietly makes poppy.ax an anonymous caller
 * with low limits. So this asks for a summary instead: 200, 404 or 400 means
 * the token is accepted, 401 means it is not, and anything else (a timeout,
 * a network error, a 429, a 5xx) gives no verdict.
 */
export async function checkToken(): Promise<TokenCheck> {
  const source = mode();
  if (source === "refused") return { kind: "bad_config" };
  if (source === "fixtures") return { kind: "ok", status: null };
  const answer = await requestJson("/api/pap/v1/summary", {
    params: { domain: "example.com" },
    auth: true,
    caching: { cache: "no-store" },
    retry: false,
  });
  if (answer.kind === "error") {
    if (answer.code === "no_token") return { kind: "bad_token", code: "no_token" };
    if (answer.code === "bad_config") return { kind: "bad_config" };
    return { kind: "unknown", code: answer.code };
  }
  if (answer.status === 401) return { kind: "bad_token", code: "unauthorized" };
  if (TOKEN_ACCEPTED.has(answer.status)) return { kind: "ok", status: answer.status };
  const failed = statusError(answer);
  return { kind: "unknown", code: failed.code, status: answer.status };
}

/** A promise that settles once, from the relay's own view of the stream. */
function cacheHitSignal(knownHit: boolean): {
  promise: Promise<boolean>;
  onEvent: (event: { type: string; servedFromCache?: boolean }) => void;
  onEnd: () => void;
} {
  let settle: (hit: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    onEvent: (event) => {
      if (event.type === "scan_complete") settle(knownHit || event.servedFromCache === true);
    },
    onEnd: () => settle(knownHit),
  };
}

/** Ora's `Date` header in Unix ms, or null when it is missing or unreadable. */
function serverDate(headers: Headers): number | null {
  const value = headers.get("date");
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Start a check of `domain` (or get Ora's stored one) and follow it. Returns
 * the progress as server-sent events cleaned for the browser, for a route to
 * relay, with `startedAt` and `servedFromCache` for isFreshSummary. Read it
 * until it closes: the result may be saved only after `scan_complete`; then
 * call pollFreshSummary.
 *
 * Sends only `domain` and `activeProbes=1`. Aborting `signal` aborts the
 * request to Ora, and so does cancelling the returned stream. Ora gets 15
 * seconds to answer with its headers; after that the stream is cut only when
 * it sends nothing for 90 seconds, or one frame grows past 1 MiB.
 */
export async function streamScan(domain: string, signal?: AbortSignal): Promise<ScanStreamResult> {
  const checked = checkDomain(domain);
  if (!checked.ok) return { kind: "invalid", code: checked.code };

  const source = mode();
  if (source === "refused") return error("bad_config");
  if (source === "fixtures") {
    const startedAt = Date.now();
    try {
      const replay = await fixtureScanStream(checked.domain, fixtureDelayMs(), signal);
      const cacheHit = cacheHitSignal(false);
      const body = relayScanEvents(replay, {
        domain: checked.domain,
        onEvent: cacheHit.onEvent,
        onEnd: cacheHit.onEnd,
        idleTimeoutMs: config.streamIdleTimeoutMs,
      });
      return { kind: "ok", body, ageSeconds: null, startedAt, servedFromCache: cacheHit.promise };
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

  const requestedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
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
    const cacheHit = cacheHitSignal(ageSeconds !== null);
    const body = relayScanEvents(response.body, {
      domain: checked.domain,
      onEvent: cacheHit.onEvent,
      onEnd: cacheHit.onEnd,
      idleTimeoutMs: config.streamIdleTimeoutMs,
    });
    const startedAt = serverDate(response.headers) ?? requestedAt;
    return { kind: "ok", body, ageSeconds, startedAt, servedFromCache: cacheHit.promise };
  }

  // Not a stream. Only a 429 body is worth reading, briefly: the daily limit
  // says when to retry in JSON, the burst limit in plain text with only the header.
  if (response.status === 429) {
    const json = parseJson(await textWithin(response, config.requestTimeoutMs));
    return error("busy", 429, retryAfter(response.headers, json));
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 200) return error("bad_response", 200);
  if (response.status === 400) return { kind: "invalid", code: "invalid_domain" };
  if (response.status === 401) return error("unauthorized", 401);
  return error("upstream", response.status);
}
