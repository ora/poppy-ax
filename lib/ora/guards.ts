// Shape checks for Ora's answers. The API is untrusted input: every value the
// pages render passes through here first. Each guard checks the fields
// ORA_API.md documents, keeps only those, and returns null when a required one
// is missing or has the wrong type. Fields the contract does not list are
// dropped. Verdicts (including `not_checked`), outcomes, reasons and
// severities pass through as strings, so a value Ora adds later reaches
// lib/verdict.ts, which falls back for it.

import { normalizeDomain } from "@/lib/domain";
import type {
  Catalog,
  CatalogRequest,
  CatalogRow,
  CountKey,
  OutcomeCounts,
  Row,
  Site,
  Summary,
} from "@/lib/ora/types";

type Json = Record<string, unknown>;

const COUNT_KEYS: readonly CountKey[] = ["tier0", "tier1", "tier2a", "tier2b", "tier3"];
const OUTCOME_KEYS = ["pass", "fail", "na", "blocked", "not_tested"] as const;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A link the pages may render: an absolute https URL. */
function isHttpsUrl(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const HOST_CHARS = /^[a-z0-9.-]+$/;

/**
 * A domain the pages may put in a URL: a lowercase ASCII host that
 * lib/domain.ts accepts. Ora answers with the requested host minus one
 * leading "www.", so subdomains stay; a leftover "www." label is allowed
 * here (the client warns when the answer differs from what it asked for).
 * Anything with a path, scheme, port or IP is refused.
 */
function isDomain(value: unknown): value is string {
  return isText(value) && HOST_CHARS.test(value) && normalizeDomain(value).ok;
}

function outcomeCounts(value: unknown): OutcomeCounts | null {
  if (!isObject(value)) return null;
  const counts = {} as OutcomeCounts;
  for (const key of OUTCOME_KEYS) {
    const count = value[key];
    if (!isCount(count)) return null;
    counts[key] = count;
  }
  return counts;
}

function summaryRow(value: unknown): Row | null {
  if (!isObject(value)) return null;
  const { id, tier, level, severity, outcome, reason, note } = value;
  if (!isText(id) || typeof tier !== "number" || !isText(level) || !isText(severity) || !isText(outcome)) {
    return null;
  }
  if (!isStringOrNull(reason) || !isStringOrNull(note)) return null;
  // Unknown values stay as strings; the casts only name the documented ones.
  return {
    id,
    tier: tier as Row["tier"],
    level: level as Row["level"],
    severity: severity as Row["severity"],
    outcome: outcome as Row["outcome"],
    reason: reason as Row["reason"],
    // Untrusted text from the scanned site: kept as a plain string.
    note,
  };
}

/** A summary as ORA_API.md documents it, or null. */
export function parseSummary(value: unknown): Summary | null {
  if (!isObject(value)) return null;
  const { domain, profile, last_run, verdict, counts, rows, probed_at, report_url } = value;
  if (!isDomain(domain) || !isText(profile) || !isText(last_run) || !isText(verdict)) return null;
  if (!isStringOrNull(probed_at) || !isHttpsUrl(report_url)) return null;
  if (!isObject(counts) || !Array.isArray(rows)) return null;

  const tierCounts = {} as Summary["counts"];
  for (const key of COUNT_KEYS) {
    const entry = outcomeCounts(counts[key]);
    if (!entry) return null;
    tierCounts[key] = entry;
  }

  const parsedRows: Row[] = [];
  for (const raw of rows) {
    const row = summaryRow(raw);
    if (!row) return null;
    parsedRows.push(row);
  }

  return {
    domain,
    profile,
    last_run,
    verdict: verdict as Summary["verdict"],
    counts: tierCounts,
    rows: parsedRows,
    probed_at,
    report_url,
  };
}

/**
 * The sites list as ORA_API.md documents it, or null. An entry whose domain
 * is not a plain domain is left out, since the page links to it.
 */
export function parseSites(value: unknown): Site[] | null {
  if (!isObject(value) || !Array.isArray(value.sites)) return null;
  const sites: Site[] = [];
  for (const raw of value.sites) {
    if (!isObject(raw)) return null;
    const { domain, first_seen, last_seen } = raw;
    if (!isText(domain) || !isText(first_seen) || !isText(last_seen)) return null;
    if (!isDomain(domain)) continue;
    sites.push({ domain, first_seen, last_seen });
  }
  return sites;
}

function catalogRequest(value: unknown): CatalogRequest | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const { method, target, condition } = value;
  if (!isString(method) || !isString(target) || !isString(condition)) return undefined;
  return { method, target, condition };
}

function catalogRow(value: unknown): CatalogRow | null {
  if (!isObject(value)) return null;
  const { id, tier, level, severity, title, spec_ref, spec_url, profile } = value;
  const { implemented, provisional, pass_when, replaces } = value;
  if (!isText(id) || typeof tier !== "number" || !isText(level) || !isText(severity) || !isText(title)) return null;
  if (!isString(spec_ref) || !isHttpsUrl(spec_url)) return null;
  if (typeof implemented !== "boolean" || typeof provisional !== "boolean") return null;
  if (!isStringOrNull(pass_when) || !isStringOrNull(replaces)) return null;
  if (profile !== undefined && !isString(profile)) return null;
  const request = catalogRequest(value.request);
  if (request === undefined) return null;
  return {
    id,
    tier: tier as CatalogRow["tier"],
    level: level as CatalogRow["level"],
    severity: severity as CatalogRow["severity"],
    title,
    spec_ref,
    spec_url,
    ...(profile === undefined ? {} : { profile }),
    implemented,
    provisional,
    request,
    pass_when,
    replaces,
  };
}

/** The check catalog as ORA_API.md documents it, or null. */
export function parseCatalog(value: unknown): Catalog | null {
  if (!isObject(value) || !Array.isArray(value.rows)) return null;
  const { profile, spec_url } = value;
  if (profile !== undefined && !isString(profile)) return null;
  if (spec_url !== undefined && !isHttpsUrl(spec_url)) return null;
  const rows: CatalogRow[] = [];
  for (const raw of value.rows) {
    const row = catalogRow(raw);
    if (!row) return null;
    rows.push(row);
  }
  return {
    ...(profile === undefined ? {} : { profile }),
    ...(spec_url === undefined ? {} : { spec_url }),
    rows,
  };
}
