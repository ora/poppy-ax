import { DOMAIN_MESSAGES, normalizeDomain } from "@/lib/domain";
import { domainErrorAnchor } from "@/lib/domain-submit";

// The domain box works without JavaScript (Ruling R38): the form submits
// GET /audit?domain=..., and app/audit/route.ts sends the visitor on.

export type DomainMessageCode = keyof typeof DOMAIN_MESSAGES;

/** The DOMAIN_MESSAGES key for a refused input, so a redirect can name the exact message. */
export function domainMessageCode(input: string): DomainMessageCode | null {
  const result = normalizeDomain(input);
  if (result.ok) return null;
  const entry = Object.entries(DOMAIN_MESSAGES).find(([, message]) => message === result.message);
  return (entry?.[0] as DomainMessageCode | undefined) ?? result.error;
}

/**
 * Where the no-JavaScript form goes: the result page for a domain the
 * normalizer accepts, else back home with the message's code. The fragment
 * names the message, which the static home page shows with :target.
 */
export function noJsCheckTarget(input: string | null): string {
  const raw = input ?? "";
  const result = normalizeDomain(raw);
  if (result.ok) return `/audit/${result.domain}`;
  const code = domainMessageCode(raw) ?? "invalid";
  return `/?error=${code}#${domainErrorAnchor(code)}`;
}
