"use client";

import { useEffect } from "react";
import { referrerHost, trackEvent } from "@/lib/analytics";

/** Records one result page view. Renders nothing. */
export function ResultViewed({ domain, verdict }: { domain: string; verdict: string }) {
  useEffect(() => {
    trackEvent("result_viewed", { domain, verdict, referrer_host: referrerHost(document.referrer) });
  }, [domain, verdict]);
  return null;
}
