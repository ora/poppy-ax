import { normalizeDomain, type DomainError } from "@/lib/domain";

// The one reading of a domain in a URL path, shared by the result page and
// the check route. Kept apart from lib/audit.ts so the route does not load
// the page's row content.

export type AuditParam =
  | { kind: "ok"; domain: string }
  | { kind: "redirect"; domain: string }
  | { kind: "invalid"; error: DomainError; message: string };

/**
 * What to do with the `[domain]` segment: render it, send the visitor to its
 * one canonical spelling (case, "www.", a trailing dot, an international
 * name), or say why it can't be checked.
 */
export function resolveAuditParam(raw: string): AuditParam {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A stray "%" stays as written; the normalizer refuses it.
  }
  const result = normalizeDomain(decoded);
  if (!result.ok) return { kind: "invalid", error: result.error, message: result.message };
  return result.domain === decoded ? { kind: "ok", domain: result.domain } : { kind: "redirect", domain: result.domain };
}

