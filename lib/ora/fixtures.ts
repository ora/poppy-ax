import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseCatalog, parseSites, parseSummary } from "@/lib/ora/guards";
import type { Catalog, InvalidDomainCode, Site, Summary, SummaryResult } from "@/lib/ora/types";

// Fixture mode: with ORA_FIXTURES=1 the client reads the recorded responses
// in fixtures/ instead of calling Ora. The files are read from disk when a
// page renders, so next.config.ts ships them with the routes that use them.

/** Where the recorded responses live. */
export const FIXTURES_DIR = join(process.cwd(), "fixtures");

/** The domain scanned in fixtures/scan-in-progress.sse (see fixtures/README.md). */
export const FIXTURE_STREAM_DOMAIN = "example.org";

/** The error file recorded for each 400 code. `localhost` has none. */
const ERROR_FILES: Readonly<Record<InvalidDomainCode, string | null>> = {
  invalid_domain: "invalid-domain.json",
  has_path: "has-path.json",
  has_port: "has-port.json",
  ip_address: "ip-address.json",
  localhost: null,
};

export function fixturesEnabled(): boolean {
  return process.env.ORA_FIXTURES === "1";
}

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES_DIR, name), "utf8")) as unknown;
}

let summaries: Promise<Map<string, Summary>> | null = null;

/** Every summary-*.json, keyed by its own `domain` field. Built once. */
function summaryIndex(): Promise<Map<string, Summary>> {
  summaries ??= (async () => {
    const index = new Map<string, Summary>();
    const names = (await readdir(FIXTURES_DIR)).filter((name) => /^summary-.+\.json$/.test(name)).sort();
    for (const name of names) {
      const summary = parseSummary(await readJson(name));
      if (!summary) throw new Error(`fixtures/${name} does not match ORA_API.md`);
      index.set(summary.domain, summary);
    }
    return index;
  })().catch((error: unknown) => {
    summaries = null;
    throw error;
  });
  return summaries;
}

/** The recorded summary for a checked domain, or not_scanned when there is none. */
export async function fixtureSummary(domain: string): Promise<SummaryResult> {
  try {
    const summary = (await summaryIndex()).get(domain);
    return summary ? { kind: "ok", summary } : { kind: "not_scanned" };
  } catch (error) {
    console.warn(`[ora] fixture summaries unreadable: ${String(error)}`);
    return { kind: "error", code: "fixture_missing" };
  }
}

/** The recorded 400 answer for a domain the parser refused. */
export async function fixtureInvalid(code: InvalidDomainCode): Promise<SummaryResult> {
  const file = ERROR_FILES[code];
  if (file === null) return { kind: "invalid", code };
  try {
    const body = await readJson(join("errors", file));
    const recorded = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    if (recorded === code) return { kind: "invalid", code };
    console.warn(`[ora] fixtures/errors/${file} records ${JSON.stringify(recorded)}, expected ${code}`);
    return { kind: "error", code: "fixture_missing" };
  } catch (error) {
    console.warn(`[ora] fixtures/errors/${file} unreadable: ${String(error)}`);
    return { kind: "error", code: "fixture_missing" };
  }
}

export async function fixtureSites(): Promise<Site[] | null> {
  try {
    return parseSites(await readJson("sites.json"));
  } catch {
    return null;
  }
}

export async function fixtureCatalog(): Promise<Catalog | null> {
  try {
    return parseCatalog(await readJson("catalog.json"));
  } catch {
    return null;
  }
}

/**
 * The recorded frames, with the scanned domain rewritten to `domain` in the
 * frames that name it, then a `scan_complete` frame (its result elided, as
 * the relay drops it anyway). Each frame is one server-sent event.
 */
export async function fixtureScanFrames(domain: string): Promise<string[]> {
  const text = await readFile(join(FIXTURES_DIR, "scan-in-progress.sse"), "utf8");
  const frames: string[] = [];
  let timestamp = 0;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.startsWith("data: ") ? block.slice(6) : null;
    if (data === null) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof frame.timestamp === "number") timestamp = frame.timestamp;
    if (data.includes(FIXTURE_STREAM_DOMAIN)) {
      for (const [key, value] of Object.entries(frame)) {
        if (typeof value === "string") frame[key] = value.replaceAll(FIXTURE_STREAM_DOMAIN, domain);
      }
    }
    frames.push(`data: ${JSON.stringify(frame)}\n\n`);
  }
  frames.push(`data: ${JSON.stringify({ type: "scan_complete", result: {}, timestamp })}\n\n`);
  return frames;
}

/**
 * Replay the recorded scan as a byte stream, `delayMs` apart, then close.
 * Aborting `signal` stops it.
 */
export async function fixtureScanStream(
  domain: string,
  delayMs: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const frames = await fixtureScanFrames(domain);
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted) {
        controller.error(signal.reason);
        return;
      }
      if (next >= frames.length) {
        controller.close();
        return;
      }
      if (delayMs > 0 && next > 0) {
        try {
          await sleep(delayMs, undefined, { signal });
        } catch {
          controller.error(signal?.reason);
          return;
        }
      }
      controller.enqueue(encoder.encode(frames[next] ?? ""));
      next += 1;
    },
  });
}
