import auditText from "@/content/audit.json";
import type { Catalog, CountKey, OutcomeCounts, Row, Severity, Summary, SummaryResult } from "@/lib/ora/types";
import { displayTitle, rowContent } from "@/lib/rows";
import { fill } from "@/lib/template";
import { fixFirst, headline, type Headline, type HeadlineKind } from "@/lib/verdict";

// The result page's logic, kept out of the components so it can be tested
// with the fixtures: which sections show, in what order, and with what words.

export type AuditContent = typeof auditText;

/** The result page's words, from content/audit.json. */
export const auditContent: AuditContent = auditText;

/** Ora runs a domain at most once in this window and serves the stored result inside it. */
export const CHECK_WINDOW_MS = 6 * 60 * 60 * 1000;

export { resolveAuditParam, type AuditParam } from "@/lib/audit-param";
import type { AuditParam } from "@/lib/audit-param";

// ---- Times --------------------------------------------------------------------

const ABSOLUTE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "10 Oct 2026, 23:13 UTC". */
export function formatAbsolute(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return `${ABSOLUTE.format(time)} UTC`;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "in 2 hours", "yesterday", "just now". */
export function formatRelative(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return seconds <= 0 ? "just now" : "in under a minute";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.trunc(seconds / size), unit);
  }
  return RELATIVE.format(Math.trunc(seconds / 60), "minute");
}

export interface TimeView {
  iso: string;
  absolute: string;
  relative: string;
}

export function timeView(iso: string, now: number): TimeView {
  return { iso, absolute: formatAbsolute(iso), relative: formatRelative(iso, now) };
}

// ---- Check again ----------------------------------------------------------------

export interface CheckAgain {
  /** True when Ora would run a new check rather than serve the stored one. */
  available: boolean;
  /** When it becomes available, or null when it already is. */
  availableAt: TimeView | null;
}

/** "Check again" is enabled only once the last run is older than Ora's 6 hour window. */
export function checkAgain(lastRun: string, now: number): CheckAgain {
  const time = Date.parse(lastRun);
  if (!Number.isFinite(time)) return { available: true, availableAt: null };
  const at = time + CHECK_WINDOW_MS;
  if (now >= at) return { available: true, availableAt: null };
  return { available: false, availableAt: timeView(new Date(at).toISOString(), now) };
}

// ---- Counts -------------------------------------------------------------------

/** The tiers the checker runs in Phase 1. */
export const MEASURED_TIERS = ["tier0", "tier1"] as const satisfies readonly CountKey[];

export interface TierCount {
  key: (typeof MEASURED_TIERS)[number];
  label: string;
  text: string;
  counts: OutcomeCounts;
}

/** "19 passed, 1 failed, 10 didn't apply". Zeros are left out. */
export function countText(counts: OutcomeCounts, content: AuditContent = auditContent): string {
  const t = content.verdict.counts;
  const parts: string[] = [];
  if (counts.pass > 0) parts.push(fill(t.pass, { n: counts.pass }));
  if (counts.fail > 0) parts.push(fill(t.fail, { n: counts.fail }));
  if (counts.na > 0) parts.push(fill(t.na, { n: counts.na }));
  const unmeasured = counts.not_tested + counts.blocked;
  if (unmeasured > 0) parts.push(fill(t.unmeasured, { n: unmeasured }));
  return parts.length > 0 ? parts.join(", ") : t.none;
}

export function tierCounts(summary: Summary, content: AuditContent = auditContent): TierCount[] {
  return MEASURED_TIERS.map((key) => ({
    key,
    label: content.verdict.tiers[key],
    text: countText(summary.counts[key], content),
    counts: summary.counts[key],
  }));
}

// ---- Sections -------------------------------------------------------------------

export interface FixRow {
  id: string;
  severity: Severity;
  title: string;
  /** One plain sentence: what failed. */
  whatFailed: string;
  /** One line: why it matters, when the row has content. */
  why: string | null;
  /** The /setup#... step that fixes it. */
  setupStep: string;
  /** The spec section the claim comes from. */
  specUrl: string | null;
  /** Untrusted text from the scanned site. Plain text only. */
  note: string | null;
}

export interface UnmeasuredView {
  id: string;
  severity: Severity;
  title: string;
  reasonText: string;
  note: string | null;
}

export type UncheckedLevel = "2a" | "2b" | "3";

export interface UncheckedGroup {
  level: UncheckedLevel;
  rows: Array<{ id: string; title: string }>;
}

const UNCHECKED_LEVELS: readonly UncheckedLevel[] = ["2a", "2b", "3"];
const NOT_MEASURED: ReadonlySet<Row["outcome"]> = new Set(["not_tested", "blocked"]);

/** Tier 2a, 2b and 3 rows this run did not measure, by name, in summary order. */
export function uncheckedGroups(summary: Summary, catalog: Catalog): UncheckedGroup[] {
  const titles = new Map(catalog.rows.map((row) => [row.id, row.title]));
  return UNCHECKED_LEVELS.map((level) => ({
    level,
    rows: summary.rows
      .filter((row) => row.level === level && NOT_MEASURED.has(row.outcome))
      .map((row) => ({ id: row.id, title: displayTitle(row.id, titles.get(row.id)) })),
  })).filter((group) => group.rows.length > 0);
}

/** The P0 and P1 failures, each as its plain sentence and the step that fixes it. */
export function fixRows(summary: Summary, catalog: Catalog): FixRow[] {
  return fixFirst(summary, catalog).map((ref) => {
    const words = rowContent(ref.id);
    return {
      id: ref.id,
      severity: ref.severity,
      title: ref.title,
      whatFailed: words.what_failed,
      why: words.why_it_matters,
      setupStep: words.setup_step,
      specUrl: words.spec_section ?? ref.catalog?.spec_url ?? null,
      note: ref.row.note,
    };
  });
}

export interface ResultView {
  domain: string;
  headline: Headline;
  /**
   * False for `not_checked` (Ruling R70): that headline is about Ora's own
   * check, not a verdict on the site, so it gets no verdict styling.
   */
  isVerdict: boolean;
  /** One sentence under the headline. Empty for "Not set up", which gets the invitation instead. */
  explain: string;
  tiers: TierCount[];
  profile: string;
  lastRun: TimeView;
  fixFirst: FixRow[];
  /** What section 2 says when there is no row to fix (not used for "Not set up", which gets the invitation). */
  fixFirstEmpty: string;
  /** "Not set up": an invitation into /setup, not a failure. */
  invitation: boolean;
  /** For "No problems found" only (Ruling R31): the P0 and P1 rows this run could not measure. */
  unmeasured: UnmeasuredView[];
  unchecked: UncheckedGroup[];
  reportUrl: string;
  /** The one line to Ora's agent-readiness audit, after "Working" only. */
  passingLine: boolean;
  checkAgain: CheckAgain;
}

function fixFirstEmpty(kind: HeadlineKind, summary: Summary, content: AuditContent): string {
  const t = content.fixFirst;
  if (kind === "unreachable") return fill(t.unreachable, { domain: summary.domain });
  if (kind === "not_checked") return t.notChecked;
  // No P0 or P1 row failed, so any failure counted here is P2 or advice. Say
  // so, or "Nothing" reads as a contradiction of the "2 failed" above it.
  const failed = MEASURED_TIERS.reduce((sum, key) => sum + summary.counts[key].fail, 0);
  if (failed === 1) return t.noneMinorOne;
  if (failed > 1) return fill(t.noneMinorMany, { n: failed });
  return t.none;
}

/** Everything the result page shows for one summary, in the order it shows it. */
export function buildResultView(
  summary: Summary,
  catalog: Catalog,
  now: number = Date.now(),
  content: AuditContent = auditContent,
): ResultView {
  const top = headline(summary, catalog);
  const kind: keyof AuditContent["verdict"]["explain"] = top.kind;
  return {
    domain: summary.domain,
    headline: top,
    isVerdict: top.kind !== "not_checked",
    explain: content.verdict.explain[kind],
    tiers: tierCounts(summary, content),
    profile: summary.profile,
    lastRun: timeView(summary.last_run, now),
    fixFirst: fixRows(summary, catalog),
    fixFirstEmpty: fixFirstEmpty(top.kind, summary, content),
    invitation: top.kind === "not_set_up",
    unmeasured:
      top.kind === "no_problems_found"
        ? top.unmeasured.map((row) => ({
            id: row.id,
            severity: row.severity,
            title: row.title,
            reasonText: row.reasonText,
            note: row.row.note,
          }))
        : [],
    unchecked: uncheckedGroups(summary, catalog),
    reportUrl: summary.report_url,
    passingLine: top.kind === "working",
    // Ora does not serve a result it could not check from its cache, so a
    // not_checked result can be checked again at once.
    checkAgain: summary.verdict === "not_checked" ? { available: true, availableAt: null } : checkAgain(summary.last_run, now),
  };
}

// ---- Metadata -----------------------------------------------------------------

export interface AuditMeta {
  title: string;
  description: string;
  /** Keep the page out of search results: no result to show. */
  noindex: boolean;
}

/** Title, description and indexing for a result page, by what Ora answered. */
export function auditMeta(
  domain: string,
  result: SummaryResult,
  catalog: Catalog,
  content: AuditContent = auditContent,
): AuditMeta {
  const m = content.metadata;
  switch (result.kind) {
    case "ok": {
      const top = headline(result.summary, catalog);
      return {
        title: fill(m.title, { domain: result.summary.domain, headline: top.text }),
        description: fill(m.descriptions[top.kind], { domain: result.summary.domain }),
        // Ora's own check failed: nothing about the site is worth indexing.
        noindex: top.kind === "not_checked",
      };
    }
    case "not_scanned":
      return { title: fill(m.checkTitle, { domain }), description: fill(m.checkDescription, { domain }), noindex: true };
    case "invalid":
      return { title: m.invalidTitle, description: content.invalid.fallback, noindex: true };
    default:
      return { title: domain, description: fill(m.errorDescription, { domain }), noindex: true };
  }
}

// ---- Preview image -----------------------------------------------------------

/**
 * The accent token for each verdict. The hex values live in
 * app/audit/[domain]/opengraph-image.tsx, because next/og cannot read CSS
 * variables.
 */
export type ImageAccent = "poppy" | "ink" | "muted";

const ACCENTS: Readonly<Record<HeadlineKind, ImageAccent>> = {
  problems: "poppy",
  working: "ink",
  no_problems_found: "ink",
  not_set_up: "muted",
  unreachable: "muted",
  not_checked: "muted",
  unknown: "muted",
};

export type ImageCard =
  | {
      kind: "result";
      domain: string;
      headline: string;
      accent: ImageAccent;
      tiers: Array<{ label: string; text: string }>;
      profile: string;
    }
  | { kind: "check"; domain: string; title: string; subtitle: string }
  | { kind: "neutral"; title: string };

/** What the preview image shows for a result. */
export function imageCard(
  param: AuditParam,
  result: SummaryResult | null,
  catalog: Catalog,
  content: AuditContent = auditContent,
): ImageCard {
  const t = content.image;
  if (param.kind === "invalid" || !result) return { kind: "neutral", title: t.fallback };
  if (result.kind === "ok") {
    const top = headline(result.summary, catalog);
    // Ora's own check failed: a neutral card, with no verdict and no counts.
    if (top.kind === "not_checked") {
      return { kind: "neutral", title: fill(t.notChecked, { domain: result.summary.domain }) };
    }
    return {
      kind: "result",
      domain: result.summary.domain,
      headline: top.text,
      accent: ACCENTS[top.kind],
      tiers: tierCounts(result.summary, content).map(({ label, text }) => ({ label, text })),
      profile: result.summary.profile,
    };
  }
  if (result.kind === "invalid") return { kind: "neutral", title: t.fallback };
  return { kind: "check", domain: param.domain, title: fill(t.check, { domain: param.domain }), subtitle: t.checkSub };
}

/**
 * The preview image's Cache-Control. An image drawn from a stored summary is
 * cached as long as the summary (60 seconds, Ora's own max-age), shared
 * caches included. Every other card ("Check <domain>", the neutral fallback)
 * is kept a minute in the browser only, so a shared cache never holds it
 * once a result exists.
 */
export function imageCacheControl(result: SummaryResult | null): string {
  return result?.kind === "ok" ? "public, max-age=60, s-maxage=60" : "private, max-age=60";
}
