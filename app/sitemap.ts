import type { MetadataRoute } from "next";
import { getSites } from "@/lib/ora/client";
import { siteUrl } from "@/lib/site-url";

// Matches the /sites page: the list of sites changes as Ora scans.
export const revalidate = 300;

/** The three pages, then the result page of every site on /sites. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl({
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    branchUrl: process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  const at = (path: string) => new URL(path, base).toString();
  const pages: MetadataRoute.Sitemap = ["/", "/setup", "/sites"].map((path) => ({ url: at(path) }));
  // No list (Ora did not answer) still serves the three pages.
  const sites = (await getSites()) ?? [];
  return [...pages, ...sites.map((site) => ({ url: at(`/audit/${site.domain}`), lastModified: site.last_seen }))];
}
