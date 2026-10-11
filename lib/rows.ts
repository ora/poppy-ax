import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import catalogJson from "@/fixtures/catalog.json";
import setup from "@/content/setup/index.json";
import type { Catalog, CatalogRow } from "@/lib/ora/types";

/** Where the per-row explanations live: content/rows/<ROW-ID>.md. */
export const ROW_CONTENT_DIR = join(process.cwd(), "content", "rows");

/** The front matter every row file must have. */
export const ROW_CONTENT_KEYS = ["what_failed", "why_it_matters", "setup_step", "spec_section"] as const;
/** Front matter a row file may add. `title` replaces the catalog title on the page. */
export const ROW_CONTENT_OPTIONAL_KEYS = ["title"] as const;
export type RowContentKey = (typeof ROW_CONTENT_KEYS)[number] | (typeof ROW_CONTENT_OPTIONAL_KEYS)[number];

/** The catalog the site ships with, from fixtures/catalog.json. */
export const fixtureCatalog = catalogJson as unknown as Catalog;

export interface RowContent {
  id: string;
  /** The file's title, else the catalog title, else the id. */
  title: string;
  /** One plain line: what failed, or for a planned check, what it will look for. */
  what_failed: string;
  /** One plain line on why it matters. Null when the row has no content file. */
  why_it_matters: string | null;
  /** A /setup#... link to the setup step that fixes it. */
  setup_step: string;
  /** The spec section the claims come from. */
  spec_section: string | null;
  /** Optional longer text after the front matter, as Markdown source. */
  body: string;
  /** "file" when content/rows has the row; "fallback" when it was built from the catalog. */
  source: "file" | "fallback";
}

export interface ParsedRowFile {
  data: Record<string, string>;
  body: string;
}

/**
 * Read a row file's front matter: one `key: value` per line between `---`
 * lines. A value in double quotes is read as a JSON string; any other value
 * is taken as written. Returns null when the file has no front matter.
 */
export function parseRowFile(source: string): ParsedRowFile | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return null;
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const pair = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1] ?? "";
    const raw = (pair[2] ?? "").trim();
    let value = raw;
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      try {
        value = JSON.parse(raw) as string;
      } catch {
        value = raw.slice(1, -1);
      }
    }
    data[key] = value;
  }
  return { data, body: source.slice(match[0].length).trim() };
}

/** The setup level that lists a row, as the /setup anchor it renders. */
export function setupAnchorFor(id: string): string {
  const level = setup.levels.find((entry) => entry.rows.includes(id));
  return level ? `/setup#${level.id}` : "/setup";
}

/**
 * Build a loader over a folder of row files and a catalog. A row with no file
 * falls back to its catalog title, so the page never breaks on a missing file.
 */
export function createRowContentLoader(dir: string, catalog: Catalog): (id: string) => RowContent {
  const byId = new Map<string, CatalogRow>(catalog.rows.map((row) => [row.id, row]));
  const cache = new Map<string, RowContent>();

  function load(id: string): RowContent {
    const entry = byId.get(id);
    const title = entry?.title ?? id;
    const fallback: RowContent = {
      id,
      title,
      what_failed: title,
      why_it_matters: null,
      setup_step: setupAnchorFor(id),
      spec_section: entry?.spec_url ?? null,
      body: "",
      source: "fallback",
    };
    // Ids come from the catalog and the API; only plain ids name a file.
    if (!/^[A-Za-z0-9-]+$/.test(id)) return fallback;
    const path = join(dir, `${id}.md`);
    if (!existsSync(path)) return fallback;
    const parsed = parseRowFile(readFileSync(path, "utf8"));
    if (!parsed) return fallback;
    const field = (key: RowContentKey) => {
      const value = parsed.data[key]?.trim();
      return value ? value : undefined;
    };
    return {
      id,
      title: field("title") ?? title,
      what_failed: field("what_failed") ?? fallback.what_failed,
      why_it_matters: field("why_it_matters") ?? fallback.why_it_matters,
      setup_step: field("setup_step") ?? fallback.setup_step,
      spec_section: field("spec_section") ?? fallback.spec_section,
      body: parsed.body,
      source: "file",
    };
  }

  // Files are read once per process in production. Only catalog ids are
  // cached, so ids from elsewhere cannot grow the cache.
  const useCache = process.env.NODE_ENV === "production";
  return (id: string) => {
    const cached = cache.get(id);
    if (cached) return cached;
    const content = load(id);
    if (useCache && byId.has(id)) cache.set(id, content);
    return content;
  };
}

/** The plain explanation for one catalog row, from content/rows/<id>.md. */
export const rowContent = createRowContentLoader(ROW_CONTENT_DIR, fixtureCatalog);
