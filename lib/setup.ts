import catalog from "@/fixtures/catalog.json";
import setup from "@/content/setup/index.json";

export type SetupContent = typeof setup;
export type SetupLevel = SetupContent["levels"][number];
export type CatalogRow = (typeof catalog)["rows"][number];

/** The setup guide's page text and its four levels, from content/setup/index.json. */
export const setupContent: SetupContent = setup;

const rowsById = new Map(catalog.rows.map((row) => [row.id, row]));

export function catalogRow(id: string): CatalogRow | undefined {
  return rowsById.get(id);
}

/**
 * A level's rows from fixtures/catalog.json, in the order the level lists
 * them. Every row in Ora's catalog is checked today, which is what the page
 * says; a listed row that is missing from the catalog, or that the catalog
 * marks as not run, stops the build rather than reading as checked.
 */
export function levelRows(level: SetupLevel): CatalogRow[] {
  return level.rows.map((id) => {
    const row = catalogRow(id);
    if (!row) throw new Error(`content/setup/index.json lists ${id}, which is not in fixtures/catalog.json`);
    if (!row.implemented) throw new Error(`content/setup/index.json lists ${id}, which fixtures/catalog.json marks as not run`);
    return row;
  });
}

/**
 * The id a setup step's h3 heading renders with: the level id, then the
 * heading text as a slug. "Name your sign-in server" in level 1 becomes
 * "level-1-name-your-sign-in-server". Row explanations link to these.
 */
export function stepId(levelId: string, heading: string): string {
  return `${levelId}-${slug(heading)}`;
}

/** Heading text as a URL fragment: "Where it stands" becomes "where-it-stands". */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
