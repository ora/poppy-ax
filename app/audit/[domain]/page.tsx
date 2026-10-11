import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cache } from "react";
import { AuditInvalid, AuditNotScanned, AuditResult, AuditUnavailable } from "@/components/audit/result";
import { auditContent, auditMeta, buildResultView, resolveAuditParam } from "@/lib/audit";
import { getCatalog, getSummary } from "@/lib/ora/client";
import { fixtureCatalog } from "@/lib/rows";
import "../audit.css";

// Rendered on every request. The summary itself is cached by the Ora client
// for 60 seconds (Ora's own max-age), under a tag the check route expires
// when a new result is saved, and not_scanned or error answers are never
// cached. So the page is as fresh as the result, a domain with no result
// never keeps a stale "not checked yet" page, and "Check again" sees the
// new result at once.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ domain: string }>;
}

const loadSummary = cache((domain: string) => getSummary(domain));
const loadCatalog = cache(async () => (await getCatalog()) ?? fixtureCatalog);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const param = resolveAuditParam((await params).domain);
  if (param.kind === "redirect") return { robots: { index: false } };
  if (param.kind === "invalid") {
    const meta = auditMeta("", { kind: "invalid", code: "invalid_domain" }, fixtureCatalog);
    return { title: meta.title, description: meta.description, robots: { index: false } };
  }
  const [result, catalog] = await Promise.all([loadSummary(param.domain), loadCatalog()]);
  const meta = auditMeta(param.domain, result, catalog);
  const canonical = `/audit/${param.domain}`;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical },
    openGraph: { title: meta.title, description: meta.description, url: canonical, siteName: "poppy.ax" },
    ...(meta.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function AuditPage({ params }: Props) {
  const param = resolveAuditParam((await params).domain);
  // A domain that can't be checked gets its reason and the domain box, in
  // place and kept out of search (robots noindex above). Not notFound(): in
  // Next 16.3 a segment not-found.tsx reached that way is not in the server
  // HTML, only drawn by client JavaScript, and this page must work without it.
  if (param.kind === "invalid") return <AuditInvalid message={param.message} />;
  if (param.kind === "redirect") permanentRedirect(`/audit/${param.domain}`);

  const [result, catalog] = await Promise.all([loadSummary(param.domain), loadCatalog()]);
  switch (result.kind) {
    case "ok":
      return <AuditResult view={buildResultView(result.summary, catalog)} />;
    case "not_scanned":
      return <AuditNotScanned domain={param.domain} />;
    case "invalid":
      // Ora refused a domain the normalizer accepted.
      return <AuditInvalid message={auditContent.invalid.fallback} />;
    default:
      return (
        <AuditUnavailable
          domain={param.domain}
          retryAfterSeconds={result.code === "busy" ? result.retryAfterSeconds : undefined}
        />
      );
  }
}
