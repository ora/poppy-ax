// Reads Ora's scan stream and writes a clean copy for the browser. Ora's
// frames are untrusted: only the frame types and fields ORA_API.md lists are
// kept, nested values are dropped (the `scan_complete` result is Ora's general
// scan and not part of the contract), and an `error` frame's free text, which
// can carry internal detail, goes to the server log only.

import type { ScanEvent } from "@/lib/ora/types";

type Json = Record<string, unknown>;

/** The fields relayed for each frame type. Every other type is dropped. */
const RELAYED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  kind_detecting: ["timestamp"],
  kind_detected: ["kind", "timestamp"],
  scan_init: ["totalChecks", "staticOnly", "timestamp"],
  discovery_phase: ["step", "label", "stepIndex", "totalSteps", "timestamp"],
  check_start: ["layerId", "layerName", "checkId", "checkName", "timestamp"],
  check_complete: ["layerId", "layerName", "checkId", "checkName", "status", "score", "maxScore", "details", "timestamp"],
  layer_complete: ["layerId", "layerName", "timestamp"],
  scan_complete: ["servedFromCache", "resultAgeSeconds", "timestamp"],
};

/** The one error text ORA_API.md documents. */
const UNREACHABLE_MESSAGE = "Domain is not reachable";

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * The data of each frame in a block of server-sent events text, parsed as
 * JSON. Frames whose data is not JSON are skipped.
 */
export function parseSseFrames(text: string): unknown[] {
  const frames: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = frameData(block);
    if (data === null) continue;
    try {
      frames.push(JSON.parse(data));
    } catch {
      // Not JSON: not a frame the contract knows.
    }
  }
  return frames;
}

/** The `data:` lines of one frame joined, or null when it has none. */
function frameData(block: string): string | null {
  const lines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5);
    lines.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export interface RelayContext {
  /** The scanned domain, for the server log. */
  domain: string;
  /** Where an `error` frame's own text goes. Defaults to console.warn. */
  log?: (message: string) => void;
}

/**
 * Turn one parsed frame into the event the browser gets, or null to drop it.
 * `completed` says whether `scan_complete` has already passed.
 */
export function cleanScanEvent(frame: unknown, completed: boolean, context: RelayContext): ScanEvent | null {
  if (!isObject(frame) || typeof frame.type !== "string") return null;
  const { type } = frame;
  if (type === "error") {
    const message = typeof frame.message === "string" ? frame.message : "";
    const log = context.log ?? ((line: string) => console.warn(line));
    log(`[ora] scan error frame for ${context.domain}: ${JSON.stringify(message)}`);
    return { type: "error", reason: message === UNREACHABLE_MESSAGE ? "unreachable" : "failed", after_complete: completed };
  }
  if (!Object.hasOwn(RELAYED_FIELDS, type)) return null;
  const event: Json = { type };
  for (const field of RELAYED_FIELDS[type] ?? []) {
    const value = frame[field];
    if (isScalar(value)) event[field] = value;
  }
  return event as ScanEvent;
}

/**
 * A clean copy of Ora's scan stream, as server-sent events. It ends when the
 * upstream stream ends, not at `scan_complete`. Cancelling it cancels the
 * upstream stream.
 */
export function relayScanEvents(upstream: ReadableStream<Uint8Array>, context: RelayContext): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let completed = false;

  function emit(block: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const data = frameData(block);
    if (data === null) return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    const event = cleanScanEvent(frame, completed, context);
    if (!event) return;
    if (event.type === "scan_complete") completed = true;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  function drain(controller: TransformStreamDefaultController<Uint8Array>) {
    for (let match = /\r?\n\r?\n/.exec(buffer); match; match = /\r?\n\r?\n/.exec(buffer)) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      emit(block, controller);
    }
  }

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        drain(controller);
      },
      flush(controller) {
        buffer += decoder.decode();
        drain(controller);
        if (buffer.trim() !== "") emit(buffer, controller);
        buffer = "";
      },
    }),
  );
}
