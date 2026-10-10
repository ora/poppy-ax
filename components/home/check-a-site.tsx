"use client";

import type { MouseEvent } from "react";
import { DOMAIN_INPUT_ID } from "./domain-form";

/**
 * A link to the domain box. Without JavaScript it scrolls to the box; with it,
 * it also puts the cursor in the box so the reader can type straight away.
 */
export function CheckASiteLink({ sectionId, text }: { sectionId: string; text: string }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const input = document.getElementById(DOMAIN_INPUT_ID);
    if (!(input instanceof HTMLInputElement)) return;
    event.preventDefault();
    document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
    input.focus({ preventScroll: true });
  }

  return (
    <a href={`#${sectionId}`} onClick={onClick} className="button button--primary">
      {text}
    </a>
  );
}
