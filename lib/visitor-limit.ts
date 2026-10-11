import "server-only";
import { checkRateLimit } from "@vercel/firewall";

// Checks per visitor IP (owner decision D7). Every request reaches Ora with
// the same token, so Ora cannot tell visitors apart: poppy.ax limits them
// first. On Vercel, with POPPY_CHECK_RATE_LIMIT_ID set, the firewall rule of
// that id decides. Anywhere else, or when the firewall cannot answer, a
// small in-memory limit per server instance does: 10 per minute per IP.

export const LOCAL_LIMIT = 10;
export const LOCAL_WINDOW_MS = 60_000;

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** A fixed-window counter per key, with a cap on how many keys it keeps. */
export class WindowLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number = LOCAL_LIMIT,
    private readonly windowMs: number = LOCAL_WINDOW_MS,
    private readonly maxKeys: number = 10_000,
  ) {}

  hit(key: string, now: number = Date.now()): LimitResult {
    let entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.delete(key);
      entry = { start: now, count: 0 };
      this.hits.set(key, entry);
      this.prune(now);
    }
    if (entry.count >= this.limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + this.windowMs - now) / 1000)) };
    }
    entry.count += 1;
    return { ok: true };
  }

  /** How many keys it holds, for tests. */
  get size(): number {
    return this.hits.size;
  }

  private prune(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
    // Still too many: drop the oldest windows first (a Map keeps insertion order).
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

/**
 * The visitor's IP as Vercel reports it, else the first forwarded address.
 * On Vercel, `x-real-ip` is set by the platform. Off Vercel both headers come
 * from whatever is in front of the server, and a client can spoof them when
 * nothing there overwrites them, so the local limit is only as good as the
 * proxy.
 */
export function visitorIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return visitorKey(real);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? visitorKey(forwarded) : "unknown";
}

/**
 * The address a visitor is counted under. An IPv6 visitor usually holds a
 * whole /64 and can pick a new address for every request, so IPv6 is counted
 * per /64 prefix; an IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function visitorKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (mapped?.[1]) return mapped[1];
  const [head, tail] = bare.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = bare.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return bare;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Which budget a request spends. Only starting a check is limited. */
export type LimitScope = "check";

export interface LimitDeps {
  env?: Readonly<Record<string, string | undefined>>;
  firewall?: typeof checkRateLimit;
  local?: WindowLimiter;
  now?: number;
}

/**
 * The firewall answers only whether a visitor is over, not when the count
 * resets, so the page shows the rule's whole window: 3600 seconds, the window
 * of the poppy-check rule in the Vercel Firewall. Change both together.
 */
const FIREWALL_RETRY_SECONDS = 3600;

const sharedLocal = new WindowLimiter();

/** Whether this visitor may make one more request in `scope`. */
export async function limitVisitor(request: Request, scope: LimitScope, deps: LimitDeps = {}): Promise<LimitResult> {
  const env = deps.env ?? process.env;
  const key = `${scope}:${visitorIp(request.headers)}`;
  const ruleId = env.POPPY_CHECK_RATE_LIMIT_ID?.trim();
  if (ruleId && env.VERCEL === "1") {
    try {
      const answer = await (deps.firewall ?? checkRateLimit)(ruleId, { request, rateLimitKey: key });
      if (answer.error === "blocked" || answer.rateLimited) return { ok: false, retryAfterSeconds: FIREWALL_RETRY_SECONDS };
      if (answer.error !== "not-found") return { ok: true };
      // The rule id is not in the dashboard: fall back to the local limit.
    } catch (error) {
      console.warn(`[limit] firewall check failed, using the local limit: ${String(error)}`);
    }
  }
  return (deps.local ?? sharedLocal).hit(key, deps.now);
}
