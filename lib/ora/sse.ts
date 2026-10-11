// Reads Ora's scan stream and writes a clean copy for the browser. Ora's
// frames are untrusted: only the frame types and fields ORA_API.md lists are
// kept, nested values are dropped (the `scan_complete` result is Ora's general
// scan and not part of the contract), and an `error` frame's free text, which
// can carry internal detail, goes to the server log only. The reader is
// bounded: one unfinished frame may hold at most 1 MiB, and a stream that
// sends nothing for 90 seconds is cut.

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

/** The most one unfinished frame may hold before the relay gives up. */
export const MAX_FRAME_BYTES = 1024 * 1024;

/** How long the relay waits for Ora to send anything before it gives up. */
export const IDLE_TIMEOUT_MS = 90_000;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/** Every line ending the event stream format allows (CRLF, LF, CR) as LF. */
function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** UTF-8 length of a string, without encoding it. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    // A surrogate pair is 4 bytes, counted 2 per half.
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

/**
 * The `data:` lines of one frame joined with LF, or null when it has none.
 * Comment lines (starting with ":") and other fields are skipped.
 */
function frameData(block: string): string | null {
  const lines: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "data") {
      lines.push("");
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5);
    lines.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * The data of each frame in a block of server-sent events text, parsed as
 * JSON. Frames whose data is not JSON are skipped.
 */
export function parseSseFrames(text: string): unknown[] {
  const frames: unknown[] = [];
  for (const block of toLf(text).split("\n\n")) {
    const data = frameData(block);
    if (data === null) continue;
    try {
      frames.push(JSON.parse(data));
    } catch (error) {
      // Not JSON: not a frame the contract knows.
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return frames;
}

export interface RelayContext {
  /** The scanned domain, for the server log. */
  domain: string;
  /** Where server-side notes go (an `error` frame's own text, a cut stream). Defaults to console.warn. */
  log?: (message: string) => void;
  /** Called with each event as it is relayed. */
  onEvent?: (event: ScanEvent) => void;
  /** Called once when the relay ends for any reason: closed, failed or cancelled. */
  onEnd?: () => void;
  /** Overrides MAX_FRAME_BYTES, for tests. */
  maxFrameBytes?: number;
  /** Overrides IDLE_TIMEOUT_MS, for tests. */
  idleTimeoutMs?: number;
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
    logLine(context, `scan error frame for ${context.domain}: ${JSON.stringify(message)}`);
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

function logLine(context: RelayContext, message: string): void {
  const log = context.log ?? ((line: string) => console.warn(line));
  log(`[ora] ${message}`);
}

class RelayStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayStop";
  }
}

/**
 * A clean copy of Ora's scan stream, as server-sent events. It ends when the
 * upstream stream ends, not at `scan_complete`. Cancelling it cancels the
 * upstream stream. It fails, and cancels upstream, when one frame grows past
 * 1 MiB or nothing arrives for 90 seconds.
 */
export function relayScanEvents(upstream: ReadableStream<Uint8Array>, context: RelayContext): ReadableStream<Uint8Array> {
  const maxFrameBytes = context.maxFrameBytes ?? MAX_FRAME_BYTES;
  const idleTimeoutMs = context.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  // Text after the last frame boundary, with LF line ends only.
  let buffer = "";
  // The UTF-8 size of `buffer`, kept as text is added and frames are cut
  // off, so a frame arriving in many tiny chunks costs linear time.
  let bufferBytes = 0;
  // The last character of `buffer`, or "" when it is empty.
  let lastChar = "";
  // Where the next search for a boundary starts: nothing before it can begin one.
  let scanFrom = 0;
  // A CR at the end of a chunk may be the first half of a CRLF.
  let pendingCr = false;
  let completed = false;
  let ended = false;

  function end(): void {
    if (ended) return;
    ended = true;
    context.onEnd?.();
  }

  function emit(block: string, out: Uint8Array[]): void {
    const data = frameData(block);
    if (data === null) return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch (error) {
      // Not JSON: not a frame the contract knows.
      if (!(error instanceof SyntaxError)) throw error;
      return;
    }
    const event = cleanScanEvent(frame, completed, context);
    if (!event) return;
    if (event.type === "scan_complete") completed = true;
    context.onEvent?.(event);
    out.push(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  /**
   * Add decoded text and pull out every finished frame. Work is linear in the
   * text added: the buffer is searched only when the new text (with the
   * character before it) holds a frame boundary, and its byte size is a
   * running total.
   */
  function take(text: string, final: boolean, out: Uint8Array[]): void {
    let chunk = (pendingCr ? "\r" : "") + text;
    pendingCr = !final && chunk.endsWith("\r");
    if (pendingCr) chunk = chunk.slice(0, -1);
    const added = toLf(chunk);
    const boundary = (lastChar + added).includes("\n\n");
    buffer += added;
    bufferBytes += utf8Length(added);
    if (added !== "") lastChar = added[added.length - 1] ?? "";
    if (boundary) {
      let start = 0;
      for (let at = buffer.indexOf("\n\n", scanFrom); at !== -1; at = buffer.indexOf("\n\n", start)) {
        emit(buffer.slice(start, at), out);
        start = at + 2;
      }
      if (start > 0) {
        bufferBytes -= utf8Length(buffer.slice(0, start));
        buffer = buffer.slice(start);
        if (buffer === "") lastChar = "";
      }
    }
    // A boundary can start on the last character only.
    scanFrom = Math.max(0, buffer.length - 1);
    if (final) {
      if (buffer.trim() !== "") emit(buffer, out);
      buffer = "";
      bufferBytes = 0;
      lastChar = "";
      scanFrom = 0;
    }
    if (bufferBytes > maxFrameBytes) {
      throw new RelayStop(`a frame from Ora grew past ${maxFrameBytes} bytes`);
    }
  }

  async function read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RelayStop(`Ora sent nothing for ${idleTimeoutMs} ms`)), idleTimeoutMs);
    });
    try {
      return await Promise.race([reader.read(), idle]);
    } finally {
      clearTimeout(timer);
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await read();
          const out: Uint8Array[] = [];
          take(done ? decoder.decode() : decoder.decode(value, { stream: true }), done, out);
          for (const bytes of out) controller.enqueue(bytes);
          if (done) {
            controller.close();
            end();
            return;
          }
          if (out.length > 0) return;
        }
      } catch (error) {
        if (error instanceof RelayStop) {
          logLine(context, `scan stream for ${context.domain} cut: ${error.message}`);
          reader.cancel(error).catch(() => undefined);
        }
        controller.error(error);
        end();
      }
    },
    async cancel(reason) {
      end();
      await reader.cancel(reason);
    },
  });
}
