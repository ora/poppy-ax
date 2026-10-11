import { describe, expect, it } from "vitest";
import {
  applyFrame,
  encodeFrame,
  INITIAL_PROGRESS,
  parseCheckResult,
  progressStep,
  readFrames,
  retryAfterOf,
  type CheckFrame,
} from "@/lib/check-progress";

function fold(frames: CheckFrame[]) {
  return frames.reduce(applyFrame, INITIAL_PROGRESS);
}

describe("readFrames", () => {
  it("returns whole frames and keeps a partial one for later", () => {
    const text = `${encodeFrame({ type: "check_started", startedAt: 5 })}data: {"type":"scan_in`;
    const { frames, rest } = readFrames(text);
    expect(frames).toEqual([{ type: "check_started", startedAt: 5 }]);
    expect(rest).toBe('data: {"type":"scan_in');
    const next = readFrames(`${rest}it","totalChecks":3}\n\n`);
    expect(next.frames).toEqual([{ type: "scan_init", totalChecks: 3 }]);
    expect(next.rest).toBe("");
  });

  it("skips frames that are not JSON objects with a type", () => {
    expect(readFrames('data: nope\n\ndata: [1]\n\ndata: {"x":1}\n\n').frames).toEqual([]);
  });
});

describe("progress", () => {
  it("counts finished checks against the announced total, capped at 100%", () => {
    const frames: CheckFrame[] = [
      { type: "scan_init", staticOnly: true },
      { type: "scan_init", totalChecks: 2 },
      { type: "check_complete" },
      { type: "check_complete" },
      { type: "check_complete" },
    ];
    expect(progressStep(fold(frames))).toEqual({ step: 2, total: 2, percent: 100 });
  });

  it("shows no step before the total is known", () => {
    expect(progressStep(fold([{ type: "check_complete" }]))).toBeNull();
  });

  it("reaches the total at scan_complete, and records a stored result", () => {
    const progress = fold([
      { type: "scan_init", totalChecks: 105 },
      { type: "check_complete" },
      { type: "scan_complete", servedFromCache: true },
    ]);
    expect(progressStep(progress)).toEqual({ step: 105, total: 105, percent: 100 });
    expect(progress.complete).toBe(true);
    expect(progress.servedFromCache).toBe(true);
  });

  it("takes when the scan began and how it ended from poppy.ax's own frames", () => {
    const progress = fold([
      { type: "check_started", startedAt: 1000 },
      { type: "scan_complete" },
      { type: "check_closed", startedAt: 1000, servedFromCache: true },
    ]);
    expect(progress).toMatchObject({ startedAt: 1000, servedFromCache: true, closed: true });
  });

  it("records an error frame, and whether it came after the scan finished", () => {
    expect(fold([{ type: "error", reason: "unreachable", after_complete: false }]).error).toEqual({
      reason: "unreachable",
      afterComplete: false,
    });
    expect(fold([{ type: "scan_complete" }, { type: "error", reason: "failed", after_complete: true }]).error).toEqual({
      reason: "failed",
      afterComplete: true,
    });
  });
});

describe("result answers", () => {
  it("reads the states the result route sends", () => {
    expect(parseCheckResult({ state: "fresh" })).toEqual({ state: "fresh" });
    expect(parseCheckResult({ state: "stale" })).toEqual({ state: "stale" });
    expect(parseCheckResult({ state: "not_scanned" })).toEqual({ state: "not_scanned" });
    expect(parseCheckResult({ state: "busy", retry_after: 30 })).toEqual({ state: "busy", retry_after: 30 });
    expect(parseCheckResult({ state: "busy" })).toEqual({ state: "busy", retry_after: null });
  });

  it("treats anything else as an error", () => {
    expect(parseCheckResult(null)).toEqual({ state: "error" });
    expect(parseCheckResult({ state: "<b>hi</b>" })).toEqual({ state: "error" });
  });

  it("reads retry_after from a 429 body", () => {
    expect(retryAfterOf({ error: "busy", retry_after: 17.2 })).toBe(18);
    expect(retryAfterOf({ error: "busy", retry_after: null })).toBeNull();
    expect(retryAfterOf("busy")).toBeNull();
  });
});
