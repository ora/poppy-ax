"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  AUDIT_TITLE_ID,
  afterRefresh,
  afterStream,
  applyFrame,
  INITIAL_PROGRESS,
  progressStep,
  readFrames,
  retryAfterOf,
  type Progress,
} from "@/lib/check-progress";
import { fill } from "@/lib/template";

/** The words this component shows. The server picks them from content/audit.json. */
export interface CheckProgressCopy {
  label: string;
  starting: string;
  running: string;
  step: string;
  saving: string;
  loading: string;
  updated: string;
  busy: string;
  busyNoTime: string;
  unreachable: string;
  failed: string;
  network: string;
  invalid: string;
  notReady: string;
  stale: string;
  tryAgain: string;
  button: string;
}

/** The line under "Check again", worded by the server for each state. */
export interface CheckAgainNotes {
  available: string;
  waiting: string;
  /** Shown when the waiting time ends while the page is open. */
  opened: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running"; progress: Progress }
  | { kind: "loading" }
  | { kind: "updated" }
  | { kind: "busy"; retryAfter: number | null }
  | { kind: "failed"; reason: "unreachable" | "failed" | "network" | "invalid" }
  | { kind: "not_ready" }
  | { kind: "stale" };

/**
 * Checks waiting for the page to show their result, by domain. Module state,
 * so it outlives the component when the refresh swaps "not checked yet" for
 * the result and this component mounts again in its new place.
 */
const waiting = new Map<string, { lastRun: string; refreshes: number }>();

export interface CheckProgressProps {
  domain: string;
  /** Start a check as soon as the page loads: the domain has no result yet. */
  autoStart: boolean;
  /** The `last_run` of the result this render shows, or null when it shows none. */
  lastRun: string | null;
  /** For "Check again": whether Ora would run a new check now. */
  available?: boolean;
  /** For "Check again": when it becomes available (ISO), if it isn't yet. */
  availableAt?: string | null;
  notes?: CheckAgainNotes;
  copy: CheckProgressCopy;
}

/**
 * Starts a check of `domain`, shows its progress, then shows the result.
 * With `autoStart` it runs at once; otherwise it is the "Check again" button.
 */
export function CheckProgress({
  domain,
  autoStart,
  lastRun,
  available = true,
  availableAt = null,
  notes,
  copy,
}: CheckProgressProps) {
  const router = useRouter();
  const noteId = useId();
  const [phase, setPhase] = useState<Phase>(autoStart ? { kind: "running", progress: INITIAL_PROGRESS } : { kind: "idle" });
  // The `availableAt` whose time has come, and the busy phase whose wait is over.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [waited, setWaited] = useState<Phase | null>(null);
  const [refreshing, startTransition] = useTransition();
  const controller = useRef<AbortController | null>(null);
  const shownLastRun = useRef(lastRun);
  const encoded = encodeURIComponent(domain);

  useEffect(() => {
    shownLastRun.current = lastRun;
  }, [lastRun]);

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

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  // After each refresh: is the new result on the page yet (Ruling R57)?
  // Refresh again a few times, about a second apart, before saying it isn't.
  useEffect(() => {
    if (refreshing) return;
    const wait = waiting.get(domain);
    if (!wait) return;
    const decision = afterRefresh(shownLastRun.current, wait.lastRun, wait.refreshes);
    const timer = setTimeout(
      () => {
        if (decision === "updated") {
          waiting.delete(domain);
          setPhase({ kind: "updated" });
          document.getElementById(AUDIT_TITLE_ID)?.focus();
        } else if (decision === "retry") {
          waiting.set(domain, { ...wait, refreshes: wait.refreshes + 1 });
          setPhase({ kind: "loading" });
          refresh();
        } else {
          waiting.delete(domain);
          setPhase({ kind: "stale" });
        }
      },
      decision === "retry" ? 1000 : 0,
    );
    return () => clearTimeout(timer);
  }, [refreshing, lastRun, domain, refresh]);

  const run = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const { signal } = abort;
    let progress = INITIAL_PROGRESS;
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
      setPhase({ kind: "busy", retryAfter: retryAfterOf(await response.json().catch(() => null)) });
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

    const end = afterStream(progress, dropped);
    switch (end.kind) {
      case "refresh":
        waiting.set(domain, { lastRun: end.lastRun, refreshes: 0 });
        setPhase({ kind: "loading" });
        refresh();
        return;
      case "stale":
        setPhase(end.hasEarlier ? { kind: "stale" } : { kind: "not_ready" });
        return;
      case "busy":
        setPhase({ kind: "busy", retryAfter: end.retryAfter });
        return;
      case "failed":
        setPhase({ kind: "failed", reason: end.reason });
    }
  }, [domain, encoded, refresh]);

  // Start at once when the domain has no result yet. Strict mode runs this
  // twice in development; the cleanup cancels the first start.
  useEffect(() => {
    if (!autoStart || waiting.has(domain)) return;
    const timer = setTimeout(() => void run(), 0);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [autoStart, domain, run]);

  useEffect(() => () => controller.current?.abort(), []);

  const status = statusText(phase, domain, copy);
  const step = phase.kind === "running" ? progressStep(phase.progress) : null;
  const busyNow = phase.kind === "running" || phase.kind === "loading";
  const opened = !available && availableAt !== null && openedAt === availableAt;
  const canCheck = (available || opened) && !busyNow;
  const retryReady = phase.kind !== "busy" || phase.retryAfter === null || phase.retryAfter <= 0 || waited === phase;
  const showRetry =
    phase.kind === "busy" || phase.kind === "failed" || phase.kind === "stale" || phase.kind === "not_ready";
  const note = notes ? (available ? notes.available : opened ? notes.opened : notes.waiting) : null;

  return (
    <div className="check">
      {!autoStart && (
        <div className="check__again">
          {/* Stays mounted and focusable while a check runs; aria-disabled says it can't be used now. */}
          <button
            type="button"
            className="button button--secondary"
            aria-disabled={!canCheck}
            aria-describedby={note ? noteId : undefined}
            onClick={() => {
              if (canCheck) void run();
            }}
          >
            {copy.button}
          </button>
          {note && (
            <p id={noteId} className="check__note">
              {note}
            </p>
          )}
        </div>
      )}
      {phase.kind === "running" && (
        <div className="check__bar">
          <progress aria-label={copy.label} max={step ? step.total : undefined} value={step ? step.step : undefined} />
          <p className="check__step" aria-hidden="true">
            {step ? fill(copy.step, { step: step.step, total: step.total }) : " "}
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
          aria-disabled={!retryReady}
          onClick={() => {
            if (retryReady) void run();
          }}
        >
          {copy.tryAgain}
        </button>
      )}
    </div>
  );
}

/** The one line a screen reader hears. It changes with the phase, not with every check. */
function statusText(phase: Phase, domain: string, copy: CheckProgressCopy): string {
  switch (phase.kind) {
    case "idle":
      return "";
    case "running":
      if (phase.progress.saving) return copy.saving;
      return phase.progress.total === null ? fill(copy.starting, { domain }) : fill(copy.running, { domain });
    case "loading":
      return copy.loading;
    case "updated":
      return copy.updated;
    case "busy":
      return phase.retryAfter === null ? copy.busyNoTime : fill(copy.busy, { seconds: phase.retryAfter });
    case "failed":
      return fill(copy[phase.reason], { domain });
    case "not_ready":
      return copy.notReady;
    case "stale":
      return copy.stale;
  }
}
