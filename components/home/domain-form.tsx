"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import type { HomeContent } from "@/lib/home";

export const DOMAIN_INPUT_ID = "domain-input";

// The normalizer pulls in the public suffix list, so it loads when someone
// starts typing rather than with the page.
const loadNormalizer = () => import("@/lib/domain");

export function DomainForm({ copy }: { copy: HomeContent["check"] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const hintId = useId();
  const messageId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { normalizeDomain } = await loadNormalizer();
    const result = normalizeDomain(input.current?.value ?? "");
    if (!result.ok) {
      setMessage(result.message);
      input.current?.focus();
      return;
    }
    setMessage("");
    router.push(`/audit/${result.domain}`);
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
          onFocus={loadNormalizer}
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
