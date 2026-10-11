import "server-only";
import { revalidateTag } from "next/cache";
import { encodeFrame } from "@/lib/check-progress";
import type { CheckResultState } from "@/lib/check-progress";
import { normalizeDomain } from "@/lib/domain";
import { pollFreshSummary, streamScan, summaryTag } from "@/lib/ora/client";
import { limitVisitor, type LimitResult, type LimitScope } from "@/lib/visitor-limit";

// The two routes a check uses, as plain functions so tests can call them:
// POST /api/check/[domain] starts the check and relays its progress, and
// GET /api/check/[domain]/result waits for the saved result once the
// progress stream has closed. The browser never talks to Ora.

export interface CheckDeps {
  limit?: (request: Request, scope: LimitScope) => Promise<LimitResult>;
  /** Called with the summary's cache tag once a fresh result is saved. */
  revalidate?: (tag: string) => void;
  now?: () => number;
}

const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function busy(retryAfterSeconds: number | undefined): Response {
  const retry = retryAfterSeconds ?? null;
  return json({ error: "busy", retry_after: retry }, 429, retry === null ? {} : { "retry-after": String(retry) });
}

/** The domain from the path, normalized, or the 400 answer. */
function checkedDomain(raw: string): { ok: true; domain: string } | { ok: false; response: Response } {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // The normalizer refuses a stray "%".
  }
  const result = normalizeDomain(decoded);
  if (result.ok) return { ok: true, domain: result.domain };
  return { ok: false, response: json({ error: "invalid_domain", code: result.error, message: result.message }, 400) };
}

/**
 * Ora's cleaned progress, between a `check_started` frame and a
 * `check_closed` frame. Cancelling it (the visitor closed the tab) cancels
 * Ora's stream. If Ora's stream fails, this one fails too, and the browser
 * goes on to wait for the result, as the scan carries on without a reader.
 */
function framed(
  body: ReadableStream<Uint8Array>,
  startedAt: number,
  servedFromCache: Promise<boolean>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeFrame({ type: "check_started", startedAt })));
    },
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        controller.error(error);
        return;
      }
      if (!chunk.done) {
        controller.enqueue(chunk.value);
        return;
      }
      const cached = await servedFromCache.catch(() => false);
      controller.enqueue(encoder.encode(encodeFrame({ type: "check_closed", startedAt, servedFromCache: cached })));
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** POST /api/check/[domain]: start a check and relay its progress as server-sent events. */
export async function startCheck(request: Request, rawDomain: string, deps: CheckDeps = {}): Promise<Response> {
  const checked = checkedDomain(rawDomain);
  if (!checked.ok) return checked.response;

  const limit = await (deps.limit ?? limitVisitor)(request, "check");
  if (!limit.ok) return busy(limit.retryAfterSeconds);

  // Only the domain goes to Ora: streamScan sends `domain` and
  // `activeProbes=1`, and nothing from this request's query string.
  const scan = await streamScan(checked.domain, request.signal);
  if (scan.kind === "invalid") return json({ error: "invalid_domain", code: scan.code }, 400);
  if (scan.kind === "error") {
    if (scan.code === "busy") return busy(scan.retryAfterSeconds);
    if (scan.code === "aborted") return new Response(null, { status: 499 });
    console.warn(`[check] could not start a check of ${checked.domain}: ${scan.code}`);
    return json({ error: "unavailable" }, 502);
  }

  return new Response(framed(scan.body, scan.startedAt, scan.servedFromCache), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** How far back a `startedAt` the browser sends back may lie. A check never runs this long. */
const MAX_CHECK_AGE_MS = 15 * 60 * 1000;

/**
 * GET /api/check/[domain]/result?startedAt=<ms>&cached=<0|1>: wait for the
 * result of the check that started at `startedAt` (Ruling R57). Fresh: the
 * summary's cache is dropped so the result page shows the new result. Stale:
 * the time ran out while Ora still had the earlier result, which the page
 * must not present as new.
 */
export async function checkResult(request: Request, rawDomain: string, deps: CheckDeps = {}): Promise<Response> {
  const checked = checkedDomain(rawDomain);
  if (!checked.ok) return checked.response;

  const url = new URL(request.url);
  const startedAt = Number(url.searchParams.get("startedAt"));
  const now = (deps.now ?? Date.now)();
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now + 60_000 || startedAt < now - MAX_CHECK_AGE_MS) {
    return json({ error: "bad_request" }, 400);
  }
  const wasCacheHit = url.searchParams.get("cached") === "1";

  const limit = await (deps.limit ?? limitVisitor)(request, "result");
  if (!limit.ok) return busy(limit.retryAfterSeconds);

  const result = await pollFreshSummary(checked.domain, { streamStartedAt: startedAt, wasCacheHit, signal: request.signal });
  let state: CheckResultState;
  switch (result.kind) {
    case "ok":
      // The result page reads the summary through Next's data cache. Drop
      // the entry from before the check, so its next render asks Ora again.
      (deps.revalidate ?? defaultRevalidate)(summaryTag(checked.domain));
      state = { state: "fresh" };
      break;
    case "stale":
      state = { state: "stale" };
      break;
    case "not_scanned":
      state = { state: "not_scanned" };
      break;
    case "error":
      state = result.code === "busy" ? { state: "busy", retry_after: result.retryAfterSeconds ?? null } : { state: "error" };
      if (result.code !== "busy") console.warn(`[check] no result for ${checked.domain}: ${result.code}`);
      break;
    default:
      state = { state: "error" };
  }
  return json(state, 200);
}

function defaultRevalidate(tag: string): void {
  // Expire at once: the very next render must miss the cache, not serve the
  // pre-check result while it refreshes in the background.
  revalidateTag(tag, { expire: 0 });
}
