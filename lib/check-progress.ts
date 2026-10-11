import type { ScanEvent } from "@/lib/ora/types";

// What the browser reads while a check runs, and what it does at the end.
// Shared by lib/check-route.ts (which writes the frames) and
// components/audit/check-progress.tsx (which reads them). No server code here.

/** The id of the result page's h1, which gets focus when a new result arrives. */
export const AUDIT_TITLE_ID = "audit-title";

/** Whether the check's result is saved, as the server found after Ora's stream closed (Rulings R57, R65). */
export type CheckResultFrame =
  | { type: "check_result"; state: "fresh"; last_run: string }
  | { type: "check_result"; state: "stale"; last_run?: string }
  | { type: "check_result"; state: "busy"; retry_after: number | null }
  | { type: "check_result"; state: "failed" };

/**
 * Frames poppy.ax adds after Ora's cleaned events: `check_saving` once Ora's
 * stream has closed, then `check_result`.
 */
export type CheckMeta = { type: "check_saving" } | CheckResultFrame;

export type CheckFrame = ScanEvent | CheckMeta;

/** One frame as server-sent events text. */
export function encodeFrame(frame: CheckFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

/**
 * Split buffered server-sent events text into the frames it completes and
 * the rest still waiting for its blank line. Frames that are not JSON objects
 * with a string `type` are skipped.
 */
export function readFrames(buffer: string): { frames: CheckFrame[]; rest: string } {
  const frames: CheckFrame[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") continue;
    try {
      const value: unknown = JSON.parse(data);
      if (typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string") {
        frames.push(value as CheckFrame);
      }
    } catch {
      // Not JSON: not a frame poppy.ax writes.
    }
  }
  return { frames, rest };
}

export interface Progress {
  /** Checks finished so far. */
  done: number;
  /** Checks Ora said it would run, once it said. */
  total: number | null;
  /** True once `scan_complete` arrived. */
  complete: boolean;
  /** True once `check_saving` arrived: Ora's stream has closed and the server is waiting for the result. */
  saving: boolean;
  /** Set by an `error` frame. */
  error: { reason: "unreachable" | "failed"; afterComplete: boolean } | null;
  /** The server's answer, once it arrived. */
  result: CheckResultFrame | null;
}

export const INITIAL_PROGRESS: Progress = {
  done: 0,
  total: null,
  complete: false,
  saving: false,
  error: null,
  result: null,
};

const RESULT_STATES: ReadonlySet<string> = new Set(["fresh", "stale", "busy", "failed"]);

/** A `check_result` frame as poppy.ax wrote it, or null for anything else. */
function readResult(frame: CheckFrame): CheckResultFrame | null {
  if (frame.type !== "check_result") return null;
  const state = (frame as { state?: unknown }).state;
  if (typeof state !== "string" || !RESULT_STATES.has(state)) return { type: "check_result", state: "failed" };
  const lastRun = (frame as { last_run?: unknown }).last_run;
  const time = typeof lastRun === "string" && Number.isFinite(Date.parse(lastRun)) ? lastRun : undefined;
  if (state === "fresh") return time ? { type: "check_result", state, last_run: time } : { type: "check_result", state: "stale" };
  if (state === "stale") return time ? { type: "check_result", state, last_run: time } : { type: "check_result", state };
  if (state === "busy") {
    const retry = (frame as { retry_after?: unknown }).retry_after;
    return {
      type: "check_result",
      state,
      retry_after: typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? Math.ceil(retry) : null,
    };
  }
  return { type: "check_result", state: "failed" };
}

/** Fold one frame into the progress. */
export function applyFrame(progress: Progress, frame: CheckFrame): Progress {
  switch (frame.type) {
    case "scan_init":
      return typeof frame.totalChecks === "number" && frame.totalChecks > 0
        ? { ...progress, total: frame.totalChecks }
        : progress;
    case "check_complete":
      return { ...progress, done: progress.done + 1 };
    case "scan_complete":
      return { ...progress, complete: true };
    case "check_saving":
      return { ...progress, saving: true };
    case "check_result":
      return { ...progress, result: readResult(frame) };
    case "error":
      return {
        ...progress,
        error: { reason: frame.reason === "unreachable" ? "unreachable" : "failed", afterComplete: frame.after_complete === true },
      };
    default:
      return progress;
  }
}

/**
 * The step to show, "step x of y". Ora can finish more checks than it
 * announced, so the step never passes the total, and the share never passes
 * 100. Null until the total is known.
 */
export function progressStep(progress: Progress): { step: number; total: number; percent: number } | null {
  if (progress.total === null) return null;
  const step = progress.complete || progress.saving ? progress.total : Math.min(progress.done, progress.total);
  return { step, total: progress.total, percent: Math.min(100, Math.round((step / progress.total) * 100)) };
}

/** What the page does once the check's stream has ended. */
export type StreamEnd =
  /** The result is saved: refresh until the page shows a result at least this new. */
  | { kind: "refresh"; lastRun: string }
  /** Time ran out while Ora still had the earlier result (or none): say so, never present it as new. */
  | { kind: "stale"; hasEarlier: boolean }
  | { kind: "busy"; retryAfter: number | null }
  | { kind: "failed"; reason: "unreachable" | "failed" | "network" };

/**
 * Decide what follows the stream. `dropped` is true when the connection
 * broke before the server's answer arrived.
 */
export function afterStream(progress: Progress, dropped: boolean): StreamEnd {
  const { result, error } = progress;
  if (result) {
    switch (result.state) {
      case "fresh":
        return { kind: "refresh", lastRun: result.last_run };
      case "stale":
        return { kind: "stale", hasEarlier: result.last_run !== undefined };
      case "busy":
        return { kind: "busy", retryAfter: result.retry_after };
      case "failed":
        if (error && !error.afterComplete) return { kind: "failed", reason: error.reason };
        return { kind: "failed", reason: "failed" };
    }
  }
  if (error && !error.afterComplete) return { kind: "failed", reason: error.reason };
  return { kind: "failed", reason: dropped ? "network" : "failed" };
}

/** How many times the page refreshes, about a second apart, waiting to show the new result. */
export const MAX_REFRESHES = 3;

/**
 * The longest one refresh may take. A refresh that never settles would leave
 * the page on "Loading the result" for good, so after this the page stops
 * waiting and says the new result isn't shown yet.
 */
export const REFRESH_TIMEOUT_MS = 5_000;

/**
 * After a refresh: is the page now showing the check's result? `rendered`
 * is the `last_run` the page shows (null when it shows none); `target` is
 * the one the server found saved. `refreshes` counts the refreshes so far.
 */
export function afterRefresh(rendered: string | null, target: string, refreshes: number): "updated" | "retry" | "stale" {
  const shown = rendered === null ? Number.NaN : Date.parse(rendered);
  const wanted = Date.parse(target);
  if (Number.isFinite(shown) && Number.isFinite(wanted) && shown >= wanted) return "updated";
  return refreshes < MAX_REFRESHES ? "retry" : "stale";
}

/** The `{error:"busy", retry_after}` body of a 429 from the check route. */
export function retryAfterOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const retry = (value as { retry_after?: unknown }).retry_after;
  return typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? Math.ceil(retry) : null;
}
