"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { submitStep } from "@/lib/domain-submit";
import type { HomeContent } from "@/lib/home";

export const DOMAIN_INPUT_ID = "domain-input";

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

export function DomainForm({ copy }: { copy: HomeContent["check"] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const hintId = useId();
  const messageId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizer = await loadNormalizer();
    const step = submitStep(input.current?.value ?? "", normalizer?.normalizeDomain ?? null);
    if (step.kind === "navigate") {
      setMessage("");
      router.push(step.path);
      return;
    }
    if (step.kind === "message") setMessage(step.message);
    input.current?.focus();
  }

  return (
    <form className="domain-form" onSubmit={onSubmit} noValidate>
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
    </form>
  );
}
