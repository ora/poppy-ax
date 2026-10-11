import { track } from "@vercel/analytics";

// The only measures the site takes. Each is a Vercel Web Analytics custom
// event with a few non-personal values. No IP, user agent, email or full URL.

export const EVENT_NAMES = [
  "domain_checked",
  "result_viewed",
  "setup_level_viewed",
  "full_report_clicked",
  "owner_verification_clicked",
  "ora_audit_clicked",
  "waitlist_clicked",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** The only values an event may carry. */
export interface EventProps {
  /** A company domain, already normalised. */
  domain?: string;
  verdict?: string;
  level?: number;
  /** The host the visitor came from. Empty for a direct visit. Never a path or query. */
  referrer_host?: string;
}

const ALLOWED_KEYS: readonly (keyof EventProps)[] = ["domain", "verdict", "level", "referrer_host"];

/** A plain host name: letters, digits, dots and hyphens. Anything else is not one. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const WORD = /^[a-z0-9_]{1,40}$/;

/** The host of a referrer URL, lowercased, and nothing else. Empty when direct or unreadable. */
export function referrerHost(referrer: string | null | undefined): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** Keeps only the known keys with plain values; drops URLs, paths and anything odd. */
export function cleanProps(props: EventProps | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!props) return out;
  const input = props as Record<string, unknown>;
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    if (key === "level") {
      if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9) out.level = value;
    } else if (key === "verdict") {
      if (typeof value === "string" && WORD.test(value)) out.verdict = value;
    } else if (key === "domain") {
      if (typeof value === "string" && value.length <= 253 && HOST.test(value)) out.domain = value;
    } else if (key === "referrer_host") {
      // An empty host is kept: it means a direct visit.
      if (value === "" || (typeof value === "string" && value.length <= 253 && HOST.test(value))) {
        out.referrer_host = value;
      }
    }
  }
  return out;
}

/** Sends one event. Never throws, so a blocked script can't break a page. */
export function trackEvent(name: EventName, props?: EventProps): void {
  if (!EVENT_NAMES.includes(name)) return;
  try {
    track(name, cleanProps(props));
  } catch {
    // Analytics is optional.
  }
}
