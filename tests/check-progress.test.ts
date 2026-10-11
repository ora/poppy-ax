import { describe, expect, it } from "vitest";
import {
  afterRefresh,
  afterStream,
  applyFrame,
  encodeFrame,
  INITIAL_PROGRESS,
  MAX_REFRESHES,
  progressStep,
  readFrames,
  REFRESH_TIMEOUT_MS,
  retryAfterOf,
  type CheckFrame,
} from "@/lib/check-progress";

function fold(frames: CheckFrame[]) {
  return frames.reduce(applyFrame, INITIAL_PROGRESS);
}

describe("readFrames", () => {
  it("returns whole frames and keeps a partial one for later", () => {
    const text = `${encodeFrame({ type: "check_saving" })}data: {"type":"scan_in`;
    const { frames, rest } = readFrames(text);
    expect(frames).toEqual([{ type: "check_saving" }]);
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

  it("reaches the total at scan_complete, and while the result is saving", () => {
    const complete = fold([{ type: "scan_init", totalChecks: 105 }, { type: "check_complete" }, { type: "scan_complete" }]);
    expect(progressStep(complete)).toEqual({ step: 105, total: 105, percent: 100 });
    const saving = fold([{ type: "scan_init", totalChecks: 105 }, { type: "check_saving" }]);
    expect(saving.saving).toBe(true);
    expect(progressStep(saving)?.percent).toBe(100);
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

  it("reads check_result defensively", () => {
    const read = (frame: unknown) => fold([frame as CheckFrame]).result;
    expect(read({ type: "check_result", state: "fresh", last_run: "2026-10-11T00:00:00Z" })).toEqual({
      type: "check_result",
      state: "fresh",
      last_run: "2026-10-11T00:00:00Z",
    });
    // "Fresh" with no time to compare against cannot be shown as new.
    expect(read({ type: "check_result", state: "fresh" })).toEqual({ type: "check_result", state: "stale" });
    expect(read({ type: "check_result", state: "fresh", last_run: "soon" })).toEqual({ type: "check_result", state: "stale" });
    expect(read({ type: "check_result", state: "busy", retry_after: 4.2 })).toEqual({
      type: "check_result",
      state: "busy",
      retry_after: 5,
    });
    expect(read({ type: "check_result", state: "<b>x</b>" })).toEqual({ type: "check_result", state: "failed" });
  });
});

describe("afterStream", () => {
  const T = "2026-10-11T00:00:00.000Z";

  it("fresh: refresh until the page shows a result this new", () => {
    expect(afterStream(fold([{ type: "check_result", state: "fresh", last_run: T }]), false)).toEqual({
      kind: "refresh",
      lastRun: T,
    });
  });

  it("stale with an earlier result, and stale with none", () => {
    expect(afterStream(fold([{ type: "check_result", state: "stale", last_run: T }]), false)).toEqual({
      kind: "stale",
      hasEarlier: true,
    });
    expect(afterStream(fold([{ type: "check_result", state: "stale" }]), false)).toEqual({ kind: "stale", hasEarlier: false });
  });

  it("busy, with and without a wait", () => {
    expect(afterStream(fold([{ type: "check_result", state: "busy", retry_after: 30 }]), false)).toEqual({
      kind: "busy",
      retryAfter: 30,
    });
    expect(afterStream(fold([{ type: "check_result", state: "busy", retry_after: null }]), false)).toEqual({
      kind: "busy",
      retryAfter: null,
    });
  });

  it("failed: the error frame's reason when the scan stopped before finishing", () => {
    const unreachable = fold([
      { type: "error", reason: "unreachable", after_complete: false },
      { type: "check_result", state: "failed" },
    ]);
    expect(afterStream(unreachable, false)).toEqual({ kind: "failed", reason: "unreachable" });
    expect(afterStream(fold([{ type: "check_result", state: "failed" }]), false)).toEqual({ kind: "failed", reason: "failed" });
    const late = fold([
      { type: "scan_complete" },
      { type: "error", reason: "failed", after_complete: true },
      { type: "check_result", state: "failed" },
    ]);
    expect(afterStream(late, false)).toEqual({ kind: "failed", reason: "failed" });
  });

  it("no answer: a dropped connection, an early error, or a stream that just ended", () => {
    expect(afterStream(fold([{ type: "scan_complete" }]), true)).toEqual({ kind: "failed", reason: "network" });
    expect(afterStream(fold([{ type: "error", reason: "unreachable", after_complete: false }]), true)).toEqual({
      kind: "failed",
      reason: "unreachable",
    });
    expect(afterStream(fold([{ type: "scan_complete" }]), false)).toEqual({ kind: "failed", reason: "failed" });
  });
});

describe("afterRefresh (Ruling R57 on the page)", () => {
  const target = "2026-10-11T00:00:00.000Z";

  it("is updated once the page shows a result at least as new as the saved one", () => {
    expect(afterRefresh(target, target, 0)).toBe("updated");
    expect(afterRefresh("2026-10-11T00:00:05.000Z", target, 2)).toBe("updated");
  });

  it("refreshes again while the page still shows an older result, or none", () => {
    expect(afterRefresh("2026-10-10T23:00:00.000Z", target, 0)).toBe("retry");
    expect(afterRefresh(null, target, MAX_REFRESHES - 1)).toBe("retry");
  });

  it("gives up after the last refresh and says the result is not shown yet", () => {
    expect(afterRefresh("2026-10-10T23:00:00.000Z", target, MAX_REFRESHES)).toBe("stale");
    expect(afterRefresh(null, target, MAX_REFRESHES)).toBe("stale");
  });

  it("never calls an unreadable time updated", () => {
    expect(afterRefresh("not a time", target, MAX_REFRESHES)).toBe("stale");
    expect(afterRefresh(target, "not a time", 0)).toBe("retry");
  });
});

describe("retryAfterOf", () => {
  it("reads retry_after from a 429 body", () => {
    expect(retryAfterOf({ error: "busy", retry_after: 17.2 })).toBe(18);
    expect(retryAfterOf({ error: "busy", retry_after: null })).toBeNull();
    expect(retryAfterOf("busy")).toBeNull();
  });
});

describe("the refresh safety timeout", () => {
  it("gives a refresh about 5 seconds, longer than the gap between refreshes", () => {
    expect(REFRESH_TIMEOUT_MS).toBe(5_000);
    expect(REFRESH_TIMEOUT_MS).toBeGreaterThan(1_000);
  });
});
