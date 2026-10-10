import catalog from "@/fixtures/catalog.json";
import setup from "@/content/setup/index.json";

export type SetupContent = typeof setup;
export type SetupLevel = SetupContent["levels"][number];
export type CatalogRow = (typeof catalog)["rows"][number];
export type RowGroup = keyof SetupContent["page"]["groups"];

/** The setup guide's page text and its four levels, from content/setup/index.json. */
export const setupContent: SetupContent = setup;

const rowsById = new Map(catalog.rows.map((row) => [row.id, row]));

export function catalogRow(id: string): CatalogRow | undefined {
  return rowsById.get(id);
}

/**
 * Which group a catalog row falls in on the setup page. Rows the checker
 * runs today come first; the rest follow the catalog's own level labels.
 */
export function rowGroup(row: CatalogRow): RowGroup {
  if (row.implemented) return "today";
  if (row.level === "2a") return "soon";
  if (row.level === "2b") return "optIn";
  return "signedIn";
}

const GROUP_ORDER: RowGroup[] = ["today", "soon", "optIn", "signedIn"];

/** A level's rows, grouped and in group order, skipping empty groups. */
export function groupedRows(level: SetupLevel): { group: RowGroup; rows: CatalogRow[] }[] {
  const rows = level.rows.map((id) => {
    const row = catalogRow(id);
    if (!row) throw new Error(`content/setup/index.json lists ${id}, which is not in fixtures/catalog.json`);
    return row;
  });
  return GROUP_ORDER.map((group) => ({ group, rows: rows.filter((row) => rowGroup(row) === group) })).filter(
    (entry) => entry.rows.length > 0,
  );
}
