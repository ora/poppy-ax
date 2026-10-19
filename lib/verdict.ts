import verdictText from "@/content/verdict.json";
import type { Catalog, CatalogRow, Outcome, Reason, Row, Severity, Summary, Verdict } from "@/lib/ora/types";
import { displayTitle } from "@/lib/rows";

export type VerdictContent = typeof verdictText;

/** The verdict page's words, from content/verdict.json. */
export const verdictContent: VerdictContent = verdictText;

/** A summary row with its catalog entry, ready for the page to render. */
export interface RowRef {
  id: string;
  severity: Severity;
  outcome: Outcome;
  /** The title to show (see displayTitle in lib/rows.ts): the row file's, else the catalog's, else the id. */
  title: string;
  row: Row;
  catalog: CatalogRow | undefined;
}

/** A row the run could not measure, with why in plain words. */
export interface UnmeasuredRow extends RowRef {
  reason: Reason | null;
  reasonText: string;
}

export type HeadlineKind = Verdict | "no_problems_found" | "unknown";

/**
 * The four plain states a reader sees. Several kinds share one: both passing
 * kinds read "Ready", and every result that says nothing about the site
 * itself reads "Couldn't check". The kind stays for analytics and styling.
 */
export type HeadlineState = "ready" | "partly" | "not_yet" | "couldnt_check";

export const HEADLINE_STATES: Readonly<Record<HeadlineKind, HeadlineState>> = {
  working: "ready",
  no_problems_found: "ready",
  problems: "partly",
  not_set_up: "not_yet",
  unreachable: "couldnt_check",
  not_checked: "couldnt_check",
  unknown: "couldnt_check",
};

/**
 * The one line answer to "does it work for agents?". `unmeasured` is filled
 * only for "No problems found": the rows that kept it from being "Working".
 * `verdict` is null when the summary carried a verdict this site does not know.
 */
export interface Headline {
  verdict: Verdict | null;
  kind: HeadlineKind;
  state: HeadlineState;
  text: string;
  unmeasured: UnmeasuredRow[];
}

const FIX_FIRST_SEVERITIES: ReadonlySet<Severity> = new Set(["P0", "P1"]);
const UNMEASURED_OUTCOMES: ReadonlySet<Outcome> = new Set(["not_tested", "blocked"]);

function catalogIndex(catalog: Catalog): Map<string, { row: CatalogRow; position: number }> {
  return new Map(catalog.rows.map((row, position) => [row.id, { row, position }]));
}

/**
 * Keep the summary rows that pass `keep`, joined to the catalog, P0 first and
 * then in catalog order. Rows the catalog does not know come last, in the
 * summary's own order.
 */
function select(summary: Summary, catalog: Catalog, keep: (row: Row, entry: CatalogRow | undefined) => boolean): RowRef[] {
  const index = catalogIndex(catalog);
  return summary.rows
    .map((row, summaryPosition) => ({ row, summaryPosition, entry: index.get(row.id) }))
    .filter(({ row, entry }) => keep(row, entry?.row))
    .sort((a, b) => {
      const bySeverity = Number(b.row.severity === "P0") - Number(a.row.severity === "P0");
      if (bySeverity !== 0) return bySeverity;
      const aPosition = a.entry?.position ?? Number.MAX_SAFE_INTEGER;
      const bPosition = b.entry?.position ?? Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition || a.summaryPosition - b.summaryPosition;
    })
    .map(({ row, entry }) => ({
      id: row.id,
      severity: row.severity,
      outcome: row.outcome,
      title: displayTitle(row.id, entry?.row.title),
      row,
      catalog: entry?.row,
    }));
}

/** What to fix first: P0 and P1 failures, P0 first, then in catalog order. */
export function fixFirst(summary: Summary, catalog: Catalog): RowRef[] {
  return select(summary, catalog, (row) => row.outcome === "fail" && FIX_FIRST_SEVERITIES.has(row.severity));
}

/** Why a row was not measured, in plain words. */
export function reasonText(row: Pick<Row, "outcome" | "reason">, content: VerdictContent = verdictContent): string {
  if (row.reason && Object.hasOwn(content.reasons, row.reason)) return content.reasons[row.reason];
  return row.outcome === "blocked" ? content.outcomes.blocked : content.outcomes.not_tested;
}

/**
 * Whether the checker runs a row today. The catalog says so; a row the
 * catalog does not know counts when it is Tier 0 or 1, the tiers that run.
 */
function runsToday(row: Row, entry: CatalogRow | undefined): boolean {
  return entry ? entry.implemented : row.tier <= 1;
}

/**
 * P0 and P1 checks the checker runs today that this run could not measure:
 * not tested, or blocked. P0 first, then in catalog order.
 */
export function unmeasured(summary: Summary, catalog: Catalog): UnmeasuredRow[] {
  return select(
    summary,
    catalog,
    (row, entry) =>
      runsToday(row, entry) && FIX_FIRST_SEVERITIES.has(row.severity) && UNMEASURED_OUTCOMES.has(row.outcome),
  ).map((ref) => ({ ...ref, reason: ref.row.reason, reasonText: reasonText(ref.row) }));
}

/**
 * The verdict headline (Rulings R31 and R42). "Working" ("Ready") needs every P0 and P1
 * check the checker runs today to have been measured; otherwise the page says
 * "No problems found" and lists what could not be measured. `not_checked`
 * (Ruling R70) says Ora's own check failed, never that the site did. A
 * verdict this site does not know gets a neutral line instead of a guess.
 */
export function headline(summary: Summary, catalog: Catalog, content: VerdictContent = verdictContent): Headline {
  const { headlines } = content;
  const plain = (kind: Verdict): Headline => ({
    verdict: kind,
    kind,
    state: HEADLINE_STATES[kind],
    text: headlines[kind],
    unmeasured: [],
  });
  switch (summary.verdict) {
    case "not_set_up":
    case "unreachable":
    case "not_checked":
    case "problems":
      return plain(summary.verdict);
    case "working": {
      const missing = unmeasured(summary, catalog);
      if (missing.length === 0) return plain("working");
      return {
        verdict: "working",
        kind: "no_problems_found",
        state: HEADLINE_STATES.no_problems_found,
        text: headlines.no_problems_found,
        unmeasured: missing,
      };
    }
    default: {
      // The API may add a verdict before this site learns it.
      const unknown: never = summary.verdict;
      void unknown;
      return { verdict: null, kind: "unknown", state: HEADLINE_STATES.unknown, text: headlines.unknown, unmeasured: [] };
    }
  }
}
