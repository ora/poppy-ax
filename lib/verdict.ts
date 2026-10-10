import verdictText from "@/content/verdict.json";
import type { Catalog, CatalogRow, Outcome, Reason, Row, Severity, Summary, Verdict } from "@/lib/ora/types";

export type VerdictContent = typeof verdictText;

/** The verdict page's words, from content/verdict.json. */
export const verdictContent: VerdictContent = verdictText;

/** A summary row with its catalog entry, ready for the page to render. */
export interface RowRef {
  id: string;
  severity: Severity;
  outcome: Outcome;
  /** The catalog title, or the id when the catalog does not know the row. */
  title: string;
  row: Row;
  catalog: CatalogRow | undefined;
}

/** A row the run could not measure, with why in plain words. */
export interface UnmeasuredRow extends RowRef {
  reason: Reason | null;
  reasonText: string;
}

export type HeadlineKind = Verdict | "no_problems_found";

/**
 * The one line answer to "does it work for agents?". `unmeasured` is filled
 * only for "No problems found": the rows that kept it from being "Working".
 */
export interface Headline {
  verdict: Verdict;
  kind: HeadlineKind;
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
      title: entry?.row.title ?? row.id,
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
  if (row.reason && row.reason in content.reasons) return content.reasons[row.reason];
  return row.outcome === "blocked" ? content.outcomes.blocked : content.outcomes.not_tested;
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
      entry?.implemented === true && FIX_FIRST_SEVERITIES.has(row.severity) && UNMEASURED_OUTCOMES.has(row.outcome),
  ).map((ref) => ({ ...ref, reason: ref.row.reason, reasonText: reasonText(ref.row) }));
}

/**
 * The verdict headline (Ruling R31). "Working" needs every P0 and P1 check
 * the checker runs today to have been measured; otherwise the page says
 * "No problems found" and lists what could not be measured.
 */
export function headline(summary: Summary, catalog: Catalog, content: VerdictContent = verdictContent): Headline {
  const { headlines } = content;
  const plain = (kind: Verdict): Headline => ({ verdict: kind, kind, text: headlines[kind], unmeasured: [] });
  switch (summary.verdict) {
    case "not_set_up":
    case "unreachable":
    case "problems":
      return plain(summary.verdict);
    case "working": {
      const missing = unmeasured(summary, catalog);
      if (missing.length === 0) return plain("working");
      return { verdict: "working", kind: "no_problems_found", text: headlines.no_problems_found, unmeasured: missing };
    }
    default: {
      const never: never = summary.verdict;
      throw new Error(`Unknown verdict: ${String(never)}`);
    }
  }
}
