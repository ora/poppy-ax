"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import auditText from "@/content/audit.json";
import {
  applyFrame,
  INITIAL_PROGRESS,
  parseCheckResult,
  progressStep,
  readFrames,
  retryAfterOf,
  type Progress,
} from "@/lib/check-progress";
import { fill } from "@/lib/template";

const t = auditText.progress;

type Phase =
  | { kind: "idle" }
  | { kind: "running"; progress: Progress }
  | { kind: "saving" }
  | { kind: "loading" }
  | { kind: "updated" }
  | { kind: "busy"; retryAfter: number | null; retry: "check" | "result" }
  | { kind: "failed"; reason: "unreachable" | "failed" | "network" | "invalid" }
  | { kind: "not_ready" }
  | { kind: "stale" };

interface Resume {
  startedAt: number;
  cached: boolean;
}

export interface CheckProgressProps {
  domain: string;
  /** Start a check as soon as the page loads: the domain has no result yet. */
  autoStart: boolean;
  /** For "Check again": whether Ora would run a new check now. */
  available?: boolean;
  /** For "Check again": when it becomes available (ISO), if it isn't yet. */
  availableAt?: string | null;
  /** The line under the button, already worded by the server. */
  note?: string;
}

/**
 * Starts a check of `domain`, shows its progress, then loads the result.
 * With `autoStart` it runs at once; otherwise it is the "Check again" button.
 */
export function CheckProgress({ domain, autoStart, available = true, availableAt = null, note }: CheckProgressProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(autoStart ? { kind: "running", progress: INITIAL_PROGRESS } : { kind: "idle" });
  // The `availableAt` whose time has come, and the busy phase whose wait is over.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [waited, setWaited] = useState<Phase | null>(null);
  const [, startTransition] = useTransition();
  const controller = useRef<AbortController | null>(null);
  const resume = useRef<Resume | null>(null);
  const encoded = encodeURIComponent(domain);

  // Enable "Check again" when Ora's window ends, if this page stays open.
  useEffect(() => {
    if (available || !availableAt) return;
    const wait = Date.parse(availableAt) - Date.now();
    if (!Number.isFinite(wait) || wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setOpenedAt(availableAt), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [available, availableAt]);

  // While busy, "Try again" waits out the time the server gave.
  useEffect(() => {
    if (phase.kind !== "busy" || phase.retryAfter === null || phase.retryAfter <= 0) return;
    const timer = setTimeout(() => setWaited(phase), phase.retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [phase]);

  const canCheck = available || (availableAt !== null && openedAt === availableAt);
  const retryReady = phase.kind !== "busy" || phase.retryAfter === null || phase.retryAfter <= 0 || waited === phase;

  const showResult = useCallback(() => {
    setPhase({ kind: "loading" });
    startTransition(() => {
      router.refresh();
      setPhase({ kind: "updated" });
    });
  }, [router]);

  const waitForResult = useCallback(
    async (from: Resume, signal: AbortSignal) => {
      resume.current = from;
      setPhase({ kind: "saving" });
      let answer: Response;
      try {
        answer = await fetch(
          `/api/check/${encoded}/result?startedAt=${Math.round(from.startedAt)}&cached=${from.cached ? 1 : 0}`,
          { cache: "no-store", signal },
        );
      } catch {
        if (!signal.aborted) setPhase({ kind: "failed", reason: "network" });
        return;
      }
      const body: unknown = await answer.json().catch(() => null);
      if (answer.status === 429) {
        setPhase({ kind: "busy", retryAfter: retryAfterOf(body), retry: "result" });
        return;
      }
      if (!answer.ok) {
        setPhase({ kind: "failed", reason: "network" });
        return;
      }
      const result = parseCheckResult(body);
      switch (result.state) {
        case "fresh":
          showResult();
          return;
        case "stale":
          setPhase({ kind: "stale" });
          return;
        case "not_scanned":
          setPhase({ kind: "not_ready" });
          return;
        case "busy":
          setPhase({ kind: "busy", retryAfter: result.retry_after, retry: "result" });
          return;
        default:
          setPhase({ kind: "failed", reason: "failed" });
      }
    },
    [encoded, showResult],
  );

  const run = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const { signal } = abort;
    let progress = INITIAL_PROGRESS;
    const requestedAt = Date.now();
    setPhase({ kind: "running", progress });

    let response: Response;
    try {
      response = await fetch(`/api/check/${encoded}`, {
        method: "POST",
        headers: { accept: "text/event-stream" },
        cache: "no-store",
        signal,
      });
    } catch {
      if (!signal.aborted) setPhase({ kind: "failed", reason: "network" });
      return;
    }
    if (response.status === 429) {
      setPhase({ kind: "busy", retryAfter: retryAfterOf(await response.json().catch(() => null)), retry: "check" });
      return;
    }
    if (response.status === 400) {
      setPhase({ kind: "failed", reason: "invalid" });
      return;
    }
    if (!response.ok || !response.body) {
      setPhase({ kind: "failed", reason: "failed" });
      return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let dropped = false;
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch {
        dropped = true;
        break;
      }
      if (chunk.done) break;
      buffer += chunk.value;
      const { frames, rest } = readFrames(buffer);
      buffer = rest;
      if (frames.length === 0) continue;
      for (const frame of frames) progress = applyFrame(progress, frame);
      setPhase({ kind: "running", progress });
    }
    if (signal.aborted) return;

    // An error before the scan finished: nothing was saved.
    if (progress.error && !progress.error.afterComplete && !progress.complete) {
      setPhase({ kind: "failed", reason: progress.error.reason });
      return;
    }
    // Finished, failed after finishing, or the connection dropped: the scan
    // saves its result without a reader, so wait for it (never start another).
    if (!dropped && !progress.closed && !progress.complete && !progress.error) {
      setPhase({ kind: "failed", reason: "failed" });
      return;
    }
    await waitForResult({ startedAt: progress.startedAt ?? requestedAt, cached: progress.servedFromCache }, signal);
  }, [encoded, waitForResult]);

  // Start at once when the domain has no result yet. Strict mode runs this
  // twice in development; the cleanup cancels the first start.
  useEffect(() => {
    if (!autoStart) return;
    const timer = setTimeout(() => void run(), 0);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [autoStart, run]);

  useEffect(() => () => controller.current?.abort(), []);

  function retry() {
    if (phase.kind === "busy" && phase.retry === "result" && resume.current) {
      const abort = new AbortController();
      controller.current = abort;
      void waitForResult(resume.current, abort.signal);
      return;
    }
    if ((phase.kind === "stale" || phase.kind === "not_ready") && resume.current) {
      const abort = new AbortController();
      controller.current = abort;
      void waitForResult(resume.current, abort.signal);
      return;
    }
    void run();
  }

  const status = statusText(phase, domain);
  const step = phase.kind === "running" ? progressStep(phase.progress) : null;
  const showButton = phase.kind === "idle" || phase.kind === "updated";
  const showRetry =
    phase.kind === "busy" || phase.kind === "failed" || phase.kind === "stale" || phase.kind === "not_ready";

  return (
    <div className="check">
      {showButton && !autoStart && (
        <div className="check__again">
          <button type="button" className="button button--secondary" onClick={() => void run()} disabled={!canCheck}>
            {auditText.checkAgain.button}
          </button>
          {note && <p className="check__note">{note}</p>}
        </div>
      )}
      {phase.kind === "running" && (
        <div className="check__bar">
          <progress
            aria-label={t.label}
            max={step ? step.total : undefined}
            value={step ? step.step : undefined}
          />
          <p className="check__step" aria-hidden="true">
            {step ? fill(t.step, { step: step.step, total: step.total }) : " "}
          </p>
        </div>
      )}
      <p className="check__status" role="status" aria-live="polite">
        {status}
      </p>
      {showRetry && (
        <button
          type="button"
          className="button button--primary"
          onClick={retry}
          disabled={phase.kind === "busy" && !retryReady}
        >
          {t.tryAgain}
        </button>
      )}
    </div>
  );
}

/** The one line a screen reader hears. It changes with the phase, not with every check. */
function statusText(phase: Phase, domain: string): string {
  switch (phase.kind) {
    case "idle":
      return "";
    case "running":
      return phase.progress.total === null ? fill(t.starting, { domain }) : fill(t.running, { domain });
    case "saving":
      return t.saving;
    case "loading":
      return t.loading;
    case "updated":
      return t.updated;
    case "busy":
      return phase.retryAfter === null ? t.busyNoTime : fill(t.busy, { seconds: phase.retryAfter });
    case "failed":
      return fill(t[phase.reason], { domain });
    case "not_ready":
      return t.notReady;
    case "stale":
      return t.stale;
  }
}
