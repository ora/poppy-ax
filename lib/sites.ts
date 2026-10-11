import type { Site } from "@/lib/ora/types";

export interface SiteRow {
  domain: string;
  /** Machine-readable date for <time dateTime>, YYYY-MM-DD in UTC. */
  isoDate: string;
  /** Plain date for people, such as "10 October 2026". */
  firstSeen: string;
  /** Path of the domain's result page on this site. */
  href: string;
}

export type SitesView =
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "list"; rows: SiteRow[] };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format an ISO time as a plain UTC date, or null when it is not a date. */
export function formatFirstSeen(iso: string): { isoDate: string; text: string } | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const month = date.getUTCMonth();
  const isoDate = `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return { isoDate, text: `${date.getUTCDate()} ${MONTHS[month]} ${date.getUTCFullYear()}` };
}

/** Rows in the order Ora sent them: most recently seen first. A row whose date cannot be read is left out. */
export function buildSiteRows(sites: readonly Site[]): SiteRow[] {
  const rows: SiteRow[] = [];
  for (const site of sites) {
    const seen = formatFirstSeen(site.first_seen);
    if (!seen) continue;
    rows.push({
      domain: site.domain,
      isoDate: seen.isoDate,
      firstSeen: seen.text,
      href: `/audit/${encodeURIComponent(site.domain)}`,
    });
  }
  return rows;
}

/** What the page shows: null from Ora means unavailable, no rows means empty. */
export function buildSitesView(sites: readonly Site[] | null): SitesView {
  if (sites === null) return { kind: "unavailable" };
  const rows = buildSiteRows(sites);
  return rows.length === 0 ? { kind: "empty" } : { kind: "list", rows };
}
