"use client";

import { usePathname } from "next/navigation";
import { content } from "@/lib/content";
import { reportErrorHref } from "@/lib/report-error";

export function ReportErrorLink() {
  const pathname = usePathname();
  const { label, newIssueUrl } = content.reportError;
  return <a href={reportErrorHref(newIssueUrl, pathname)}>{label}</a>;
}
