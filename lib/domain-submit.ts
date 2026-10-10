import type { DomainResult } from "./domain";

export type SubmitStep =
  | { kind: "navigate"; path: string }
  | { kind: "message"; message: string }
  | { kind: "stay" };

/**
 * What the domain box does on submit. With the normalizer, it goes to the
 * result page for the clean domain or shows the friendly message. If the
 * normalizer failed to load, it sends the raw input to the result page to
 * judge, and does nothing for an empty box.
 */
export function submitStep(raw: string, normalize: ((input: string) => DomainResult) | null): SubmitStep {
  if (!normalize) {
    const trimmed = raw.trim();
    return trimmed === "" ? { kind: "stay" } : { kind: "navigate", path: `/audit/${encodeURIComponent(trimmed)}` };
  }
  const result = normalize(raw);
  return result.ok ? { kind: "navigate", path: `/audit/${result.domain}` } : { kind: "message", message: result.message };
}
