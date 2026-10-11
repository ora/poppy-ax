import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageIntro } from "@/components/page-intro";
import { content } from "@/lib/content";
import { getSites } from "@/lib/ora/client";
import { buildSitesView } from "@/lib/sites";
import "./sites.css";

// Matches the client's cache of the sites list.
export const revalidate = 300;

const page = content.pages.sites;

export const metadata: Metadata = {
  title: page.title,
  description: page.description,
  alternates: { canonical: "/sites" },
};

export default async function SitesPage() {
  const sites = await getSites();
  // A render with no list must not be kept for the full five minutes.
  // connection() replaces unstable_noStore, which Next 16 lists as legacy.
  if (sites === null) await connection();
  const view = buildSitesView(sites);
  return (
    <div className="sites">
      <PageIntro heading={page.heading} lede={page.lede} />
      {view.kind === "unavailable" && <p className="sites__state">{page.unavailable}</p>}
      {view.kind === "empty" && (
        <p className="sites__state">
          {page.empty} <Link href={page.emptyLink.href}>{page.emptyLink.text}</Link>.
        </p>
      )}
      {view.kind === "list" && (
        <>
          <p className="sites__order">{page.order}</p>
          <ul className="sites__list" aria-label={page.listLabel}>
            {view.rows.map((row) => (
              <li key={row.domain} className="sites__row">
                <span className="sites__domain">{row.domain}</span>
                <span className="sites__meta">
                  {page.firstSeen} <time dateTime={row.isoDate}>{row.firstSeen}</time>
                </span>
                <Link href={row.href} className="sites__link">
                  {page.resultLinkText}
                  <span className="visually-hidden"> for {row.domain}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="sites__note">{page.note}</p>
        </>
      )}
      <p className="sites__arc">
        {page.arc.before}
        <a href={page.arc.href}>{page.arc.linkText}</a>
        {page.arc.after}
      </p>
    </div>
  );
}
