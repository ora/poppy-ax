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

/** Why a check was not run, or not run to the end. */
export type Reason =
  | "timeout"
  | "deadline"
  | "rate_limited"
  | "owner_opt_out"
  | "out_of_scope"
  | "not_available"
  | "opt_in_required";

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
