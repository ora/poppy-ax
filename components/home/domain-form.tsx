"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { trackEvent } from "@/lib/analytics";
import { CHECK_SECTION_ID, DOMAIN_INPUT_ID } from "@/lib/check-anchor";
import { domainErrorAnchor, submitStep } from "@/lib/domain-submit";
import type { HomeContent } from "@/lib/home";

// The normalizer pulls in the public suffix list, so it loads when someone
// focuses the box rather than with the page. A failed load (offline, a chunk
// lost after a deploy) resolves to null instead of rejecting.
type Normalizer = typeof import("@/lib/domain");
const loadNormalizer = (): Promise<Normalizer | null> =>
  import("@/lib/domain").catch((error: unknown) => {
    console.warn("Could not load the domain checker", error);
    return null;
  });

function preload() {
  void loadNormalizer();
}

export interface DomainFormProps {
  copy: HomeContent["check"];
  /** A message to show from the start, such as why the last domain can't be checked. */
  initialMessage?: string;
  /**
   * Messages for the no-JavaScript path (Ruling R38), keyed by code. Each is
   * hidden until the URL's fragment names it (`/?error=<code>#domain-error-<code>`),
   * so the page stays static. Only known codes have one.
   */
  fallbackMessages?: Readonly<Record<string, string>>;
}

/** Drop a no-JavaScript message's fragment once the visitor moves on. */
function clearFallbackFragment() {
  if (window.location.hash.startsWith(`#${domainErrorAnchor("")}`)) {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }
}

export function DomainForm({ copy, initialMessage = "", fallbackMessages }: DomainFormProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState(initialMessage);
  const hintId = useId();
  const messageId = useId();

  // "Check a site" on another page links to /#check: arrive with the cursor in the box.
  useEffect(() => {
    if (window.location.hash === `#${CHECK_SECTION_ID}`) input.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFallbackFragment();
    const normalizer = await loadNormalizer();
    const step = submitStep(input.current?.value ?? "", normalizer?.normalizeDomain ?? null);
    if (step.kind === "navigate") {
      setMessage("");
      // Only a normalised domain is recorded; the fallback path has the raw text.
      if (normalizer) trackEvent("domain_checked", { domain: decodeURIComponent(step.path.slice("/audit/".length)) });
      router.push(step.path);
      return;
    }
    if (step.kind === "message") setMessage(step.message);
    input.current?.focus();
  }

  return (
    // Without JavaScript the form goes to app/audit/route.ts, which sends the
    // visitor to the result page or back with the message's code.
    <form className="domain-form" action="/audit" method="get" onSubmit={onSubmit} noValidate>
      <label htmlFor={DOMAIN_INPUT_ID} className="domain-form__label">
        {copy.label}
      </label>
      <p id={hintId} className="domain-form__hint">
        {copy.hint}
      </p>
      <div className="domain-form__row">
        <input
          ref={input}
          id={DOMAIN_INPUT_ID}
          name="domain"
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={copy.placeholder}
          aria-describedby={`${hintId} ${messageId}`}
          aria-invalid={message ? true : undefined}
          onFocus={preload}
          onChange={() => message && setMessage("")}
          className="domain-form__input"
        />
        <button type="submit" className="button button--primary">
          {copy.button}
        </button>
      </div>
      <p id={messageId} className="domain-form__message" aria-live="polite">
        {message}
      </p>
      {fallbackMessages &&
        Object.entries(fallbackMessages).map(([code, text]) => (
          <p key={code} id={domainErrorAnchor(code)} className="domain-form__fallback" tabIndex={-1}>
            {text}
          </p>
        ))}
    </form>
  );
}
