// The shapes of the public summary API and the check catalog, as poppy.ax
// reads them. ORA_API.md documents the API; these types follow it.

/** The one verdict a summary gives for a domain. */
export type Verdict = "not_set_up" | "unreachable" | "problems" | "working";

/** What happened to one check in a run. */
export type Outcome = "pass" | "fail" | "na" | "blocked" | "not_tested";

/** How much a check matters. "Adv" is advisory. */
export type Severity = "P0" | "P1" | "P2" | "Adv";

export type Tier = 0 | 1 | 2 | 3;

/** The catalog's finer split of tiers. Tier 2 is 2a (coming soon) and 2b (opt-in). */
export type Level = "0" | "1" | "2a" | "2b" | "3";

/**
 * Why a check was not run, or not run to the end. The API may send a reason
 * that is not listed here; the page treats it as "not measured".
 */
export const REASONS = [
  "timeout",
  "deadline",
  // Ora checked the site recently and kept the earlier round's result.
  "probe_cooldown",
  // Ora's own check failed to run.
  "check_error",
  "owner_opt_out",
  "out_of_scope",
  "not_available",
  "opt_in_required",
] as const;

export type Reason = (typeof REASONS)[number];

export type CountKey = "tier0" | "tier1" | "tier2a" | "tier2b" | "tier3";

export type OutcomeCounts = Record<Outcome, number>;

/** One check's result in a summary. */
export interface Row {
  id: string;
  tier: Tier;
  level: Level;
  severity: Severity;
  outcome: Outcome;
  reason: Reason | null;
  /**
   * Untrusted text from the scanned site. Render it as plain text only:
   * never as HTML or Markdown.
   */
  note: string | null;
}

/** The public summary for one domain. */
export interface Summary {
  domain: string;
  profile: string;
  /** ISO 8601 time of the last run. */
  last_run: string;
  verdict: Verdict;
  counts: Record<CountKey, OutcomeCounts>;
  rows: Row[];
  /** ISO 8601 time of the last active probe, or null when none ran. */
  probed_at: string | null;
  report_url: string;
}

/** The request a check sends, when it sends one of its own. */
export interface CatalogRequest {
  method: string;
  target: string;
  condition: string;
}

/** One check in the catalog. */
export interface CatalogRow {
  id: string;
  tier: Tier;
  level: Level;
  severity: Severity;
  title: string;
  spec_ref: string;
  spec_url: string;
  profile?: string;
  /** True when the checker runs this check today. */
  implemented: boolean;
  /** True for a planned check whose details may still change. */
  provisional: boolean;
  request: CatalogRequest | null;
  pass_when: string | null;
  /** The id of an older check this one replaces, if any. */
  replaces: string | null;
}

/** The check catalog. */
export interface Catalog {
  profile?: string;
  spec_url?: string;
  rows: readonly CatalogRow[];
}

/** One domain on the sites list: a scan found its poppy.json. */
export interface Site {
  /** The domain as Ora stores it (the host, minus one leading "www."). */
  domain: string;
  /** ISO 8601 time a scan first found its poppy.json. */
  first_seen: string;
  /** ISO 8601 time of the latest scan that found it. */
  last_seen: string;
}

/** The 400 codes the summary API answers for a domain it will not look up. */
export const INVALID_DOMAIN_CODES = ["invalid_domain", "has_path", "has_port", "ip_address", "localhost"] as const;

export type InvalidDomainCode = (typeof INVALID_DOMAIN_CODES)[number];

/**
 * Why a call to Ora gave no result.
 * - `no_token`: poppy.ax refused to call Ora, because ORA_SERVICE_TOKEN is unset.
 * - `bad_config`: poppy.ax will not call Ora as configured: ORA_BASE_URL is
 *   not https (plain http only for a loopback host or outside Vercel
 *   production), or ORA_FIXTURES=1 in Vercel production.
 * - `unauthorized`: Ora refused the token.
 * - `busy`: Ora answered 429; `retryAfterSeconds` says when to try again, if it said.
 * - `upstream`: any other status Ora should not have answered.
 * - `timeout`, `aborted`, `network`: no answer arrived.
 * - `bad_response`: the answer did not match ORA_API.md.
 * - `fixture_missing`: fixture mode could not read a file in fixtures/.
 */
export type OraErrorCode =
  | "no_token"
  | "bad_config"
  | "unauthorized"
  | "busy"
  | "upstream"
  | "timeout"
  | "aborted"
  | "network"
  | "bad_response"
  | "fixture_missing";

export interface OraError {
  kind: "error";
  code: OraErrorCode;
  /** The HTTP status Ora answered with, when it answered. */
  status?: number;
  /** For `busy`: seconds until Ora takes another request, when it said. */
  retryAfterSeconds?: number;
}

/** The result of asking for one domain's summary. */
export type SummaryResult =
  | { kind: "ok"; summary: Summary }
  | { kind: "not_scanned" }
  | { kind: "invalid"; code: InvalidDomainCode }
  | OraError;

/**
 * The result of waiting for a scan's summary. `stale` means the time ran out
 * while Ora still answered with a result from before the scan.
 */
export type FreshSummaryResult = SummaryResult | { kind: "stale"; summary: Summary };

/**
 * A started scan: its progress as server-sent events, cleaned for the
 * browser (see lib/ora/sse.ts). Read it until it closes: the result may be
 * saved only after `scan_complete`.
 *
 * `startedAt` and `servedFromCache` are the inputs isFreshSummary needs.
 */
export type ScanStreamResult =
  | {
      kind: "ok";
      body: ReadableStream<Uint8Array>;
      /** Ora's `Age` header, set when it served a stored result instead of scanning again. */
      ageSeconds: number | null;
      /**
       * When the scan began, in Unix ms: Ora's `Date` response header when it
       * sent one (whole seconds), else the time just before the request.
       */
      startedAt: number;
      /**
       * Whether Ora served a stored result: true when it sent an `Age` header
       * or its `scan_complete` says `servedFromCache`. Settles at
       * `scan_complete`, or when the body ends, fails or is cancelled, so
       * await it only while or after reading the body, never before.
       */
      servedFromCache: Promise<boolean>;
    }
  | { kind: "invalid"; code: InvalidDomainCode }
  | OraError;

/**
 * Whether Ora accepts poppy.ax's service token.
 * - `ok`: Ora answered 200, 404 or 400 to an authenticated request (`status`
 *   is null in fixture mode, where no token is needed).
 * - `bad_token`: the token is unset, or Ora answered 401.
 * - `unknown`: no verdict (a timeout, a network error, a 429 or a 5xx).
 * - `bad_config`: poppy.ax will not call Ora as configured (ORA_BASE_URL, or
 *   fixture mode in production).
 */
export type TokenCheck =
  | { kind: "ok"; status: number | null }
  | { kind: "bad_token"; code: "no_token" | "unauthorized" }
  | { kind: "unknown"; code: OraErrorCode; status?: number }
  | { kind: "bad_config" };

/** A progress event as poppy.ax relays it to the browser. */
export type ScanEvent =
  | { type: "kind_detecting"; timestamp?: number }
  | { type: "kind_detected"; kind?: string; timestamp?: number }
  | { type: "scan_init"; totalChecks?: number; staticOnly?: boolean; timestamp?: number }
  | {
      type: "discovery_phase";
      step?: string;
      label?: string;
      stepIndex?: number;
      totalSteps?: number;
      timestamp?: number;
    }
  | { type: "check_start"; layerId?: string; layerName?: string; checkId?: string; checkName?: string; timestamp?: number }
  | {
      type: "check_complete";
      layerId?: string;
      layerName?: string;
      checkId?: string;
      checkName?: string;
      /** `pass`, `fail`, `warning` or `na`; others may appear. */
      status?: string;
      score?: number;
      maxScore?: number;
      /** Text about the scanned site. Plain text only. */
      details?: string;
      timestamp?: number;
    }
  | { type: "layer_complete"; layerId?: string; layerName?: string; timestamp?: number }
  | { type: "scan_complete"; servedFromCache?: boolean; resultAgeSeconds?: number; timestamp?: number }
  | {
      type: "error";
      /** `unreachable` when the domain did not answer; `failed` for anything else. */
      reason: "unreachable" | "failed";
      /** True when the error came after `scan_complete`: fetch the summary anyway. */
      after_complete: boolean;
    };
