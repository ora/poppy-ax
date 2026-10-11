import type { ScanEvent } from "@/lib/ora/types";

// What the browser reads while a check runs, and how it turns that into
// progress. Shared by app/api/check/[domain] (which writes the frames) and
// components/audit/check-progress.tsx (which reads them). No server code here.

/**
 * Frames poppy.ax adds around Ora's cleaned events:
 * - `check_started` comes first, with when the scan began (Unix ms).
 * - `check_closed` comes last, once Ora's stream has closed, with whether
 *   Ora served a stored result. Both feed the result route's freshness rule.
 */
export type CheckMeta =
  | { type: "check_started"; startedAt: number }
  | { type: "check_closed"; startedAt: number; servedFromCache: boolean };

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
  /** When the scan began, from `check_started`. */
  startedAt: number | null;
  /** Whether Ora served a stored result, as far as known. */
  servedFromCache: boolean;
  /** Set by an `error` frame. */
  error: { reason: "unreachable" | "failed"; afterComplete: boolean } | null;
  /** True once `check_closed` arrived: Ora's stream ended normally. */
  closed: boolean;
}

export const INITIAL_PROGRESS: Progress = {
  done: 0,
  total: null,
  complete: false,
  startedAt: null,
  servedFromCache: false,
  error: null,
  closed: false,
};

/** Fold one frame into the progress. */
export function applyFrame(progress: Progress, frame: CheckFrame): Progress {
  switch (frame.type) {
    case "check_started":
      return { ...progress, startedAt: Number.isFinite(frame.startedAt) ? frame.startedAt : progress.startedAt };
    case "check_closed":
      return {
        ...progress,
        closed: true,
        startedAt: Number.isFinite(frame.startedAt) ? frame.startedAt : progress.startedAt,
        servedFromCache: progress.servedFromCache || frame.servedFromCache === true,
      };
    case "scan_init":
      return typeof frame.totalChecks === "number" && frame.totalChecks > 0
        ? { ...progress, total: frame.totalChecks }
        : progress;
    case "check_complete":
      return { ...progress, done: progress.done + 1 };
    case "scan_complete":
      return { ...progress, complete: true, servedFromCache: progress.servedFromCache || frame.servedFromCache === true };
    case "error":
      return { ...progress, error: { reason: frame.reason === "unreachable" ? "unreachable" : "failed", afterComplete: frame.after_complete === true } };
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
  const step = progress.complete ? progress.total : Math.min(progress.done, progress.total);
  return { step, total: progress.total, percent: Math.min(100, Math.round((step / progress.total) * 100)) };
}

/** What the result route answers once a check has ended. */
export type CheckResultState =
  | { state: "fresh" }
  | { state: "stale" }
  | { state: "not_scanned" }
  | { state: "busy"; retry_after: number | null }
  | { state: "error" };

/** Read the result route's JSON, treating anything unexpected as an error. */
export function parseCheckResult(value: unknown): CheckResultState {
  if (typeof value !== "object" || value === null) return { state: "error" };
  const state = (value as { state?: unknown }).state;
  if (state === "fresh" || state === "stale" || state === "not_scanned") return { state };
  if (state === "busy") {
    const retry = (value as { retry_after?: unknown }).retry_after;
    return { state, retry_after: typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? retry : null };
  }
  return { state: "error" };
}

/** The `{error:"busy", retry_after}` body of a 429 from the check routes. */
export function retryAfterOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const retry = (value as { retry_after?: unknown }).retry_after;
  return typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? Math.ceil(retry) : null;
}
