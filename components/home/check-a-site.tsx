"use client";

import type { MouseEvent } from "react";
import { CHECK_HREF, CHECK_SECTION_ID, DOMAIN_INPUT_ID } from "@/lib/check-anchor";

/**
 * A link to the domain box on the home page. On the home page with
 * JavaScript, it scrolls to the box and puts the cursor in it. Anywhere else
 * it is a plain link to /#check, and the box takes the cursor when it loads.
 */
export function CheckASiteLink({ text, className }: { text: string; className?: string }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const input = document.getElementById(DOMAIN_INPUT_ID);
    if (!(input instanceof HTMLInputElement)) return;
    event.preventDefault();
    document.getElementById(CHECK_SECTION_ID)?.scrollIntoView({ block: "start" });
    input.focus({ preventScroll: true });
  }

  return (
    <a href={CHECK_HREF} onClick={onClick} className={className}>
      {text}
    </a>
  );
}
