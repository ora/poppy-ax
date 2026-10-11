import "server-only";
import { encodeFrame, readFrames, type CheckResultFrame } from "@/lib/check-progress";
import { resolveAuditParam } from "@/lib/audit-param";
import { pollFreshSummary, streamScan, summaryTag } from "@/lib/ora/client";
import { limitVisitor, type LimitResult, type LimitScope } from "@/lib/visitor-limit";

// POST /api/check/[domain], as a plain function so tests can call it. It
// starts a check, relays Ora's cleaned progress, and once Ora's stream has
// closed waits on the server for the saved result (Ruling R57, moved inside
// the stream by Ruling R65). The browser never talks to Ora, and the inputs
// of the freshness rule (when the scan began, whether Ora served a stored
// result) never leave the server.

export interface CheckDeps {
  limit?: (request: Request, scope: LimitScope) => Promise<LimitResult>;
  /**
   * Schedules the expiry of a fresh result's cached summary, so the result
   * page's next render asks Ora again. Called with a promise of the tag, or
   * of null when there is nothing to expire.
   */
  scheduleRevalidate?: (tag: Promise<string | null>) => void;
}

const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function busy(retryAfterSeconds: number | undefined): Response {
  const retry = retryAfterSeconds ?? null;
  return json({ error: "busy", retry_after: retry }, 429, retry === null ? {} : { "retry-after": String(retry) });
}

/**
 * Whether a request comes from another site: the browser says so in
 * `Sec-Fetch-Site`, or sends an `Origin` whose host is not this one. A
 * check costs Ora's time and the visitor's budget, so only poppy.ax's own
 * pages may start one.
 */
export function isCrossSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return originHost.toLowerCase() !== host.toLowerCase();
}

interface StreamFacts {
  complete: boolean;
  /** An `error` frame arrived before `scan_complete`: nothing was saved. */
  failedBeforeComplete: boolean;
}

/**
 * Ora's cleaned progress, then `check_result`. Cancelling it (the visitor
 * closed the tab) cancels Ora's stream and the wait. If Ora's stream fails
 * after it began, the scan carries on without a reader, so the wait still
 * runs.
 */
function checkStream(
  domain: string,
  scan: { body: ReadableStream<Uint8Array>; startedAt: number; servedFromCache: Promise<boolean> },
  signal: AbortSignal,
  revalidateTag: (tag: string | null) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = scan.body.getReader();
  const facts: StreamFacts = { complete: false, failedBeforeComplete: false };
  let buffer = "";
  let finished = false;

  function watch(chunk: Uint8Array) {
    buffer += decoder.decode(chunk, { stream: true });
    const { frames, rest } = readFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.type === "scan_complete") facts.complete = true;
      if (frame.type === "error" && !facts.complete) facts.failedBeforeComplete = true;
    }
  }

  async function result(): Promise<CheckResultFrame> {
    if (facts.failedBeforeComplete) return { type: "check_result", state: "failed" };
    const wasCacheHit = await scan.servedFromCache.catch(() => false);
    const answer = await pollFreshSummary(domain, { streamStartedAt: scan.startedAt, wasCacheHit, signal });
    switch (answer.kind) {
      case "ok":
        revalidateTag(summaryTag(domain));
        return { type: "check_result", state: "fresh", last_run: answer.summary.last_run };
      case "stale":
        return { type: "check_result", state: "stale", last_run: answer.summary.last_run };
      case "not_scanned":
        // Nothing saved yet, and no earlier result to fall back on.
        return { type: "check_result", state: "stale" };
      case "error":
        if (answer.code === "busy") {
          return { type: "check_result", state: "busy", retry_after: answer.retryAfterSeconds ?? null };
        }
        console.warn(`[check] no result for ${domain}: ${answer.code}`);
        return { type: "check_result", state: "failed" };
      default:
        return { type: "check_result", state: "failed" };
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    revalidateTag(null);
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array> | null;
      try {
        chunk = await reader.read();
      } catch (error) {
        console.warn(`[check] progress stream for ${domain} ended early: ${String(error)}`);
        chunk = null;
      }
      if (chunk && !chunk.done) {
        watch(chunk.value);
        controller.enqueue(chunk.value);
        return;
      }
      if (signal.aborted) {
        finish();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeFrame({ type: "check_saving" })));
      const frame = await result();
      finish();
      if (signal.aborted) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeFrame(frame)));
      controller.close();
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
}

/** POST /api/check/[domain]: start a check, relay its progress, then say whether its result is saved. */
export async function startCheck(request: Request, rawDomain: string, deps: CheckDeps = {}): Promise<Response> {
  if (isCrossSite(request)) return json({ error: "forbidden" }, 403);

  const param = resolveAuditParam(rawDomain);
  if (param.kind === "invalid") {
    return json({ error: "invalid_domain", code: param.error, message: param.message }, 400);
  }
  const domain = param.domain;

  const limit = await (deps.limit ?? limitVisitor)(request, "check");
  if (!limit.ok) return busy(limit.retryAfterSeconds);

  // Only the domain goes to Ora: streamScan sends `domain` and
  // `activeProbes=1`, and nothing from this request's query string.
  const scan = await streamScan(domain, request.signal);
  if (scan.kind === "invalid") return json({ error: "invalid_domain", code: scan.code }, 400);
  if (scan.kind === "error") {
    if (scan.code === "busy") return busy(scan.retryAfterSeconds);
    if (scan.code === "aborted") return new Response(null, { status: 499 });
    console.warn(`[check] could not start a check of ${domain}: ${scan.code}`);
    return json({ error: "unavailable" }, 502);
  }

  let settle: (tag: string | null) => void = () => undefined;
  const tag = new Promise<string | null>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  const revalidateOnce = (value: string | null) => {
    if (settled) return;
    settled = true;
    settle(value);
  };
  deps.scheduleRevalidate?.(tag);

  return new Response(checkStream(domain, scan, request.signal, revalidateOnce), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
