"use client";

import type { AnchorHTMLAttributes } from "react";
import { trackEvent, type EventName, type EventProps } from "@/lib/analytics";

export interface TrackedLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  event: EventName;
  eventProps?: EventProps;
}

/** A plain link that records one event on click. Lets server components stay server components. */
export function TrackedLink({ event, eventProps, onClick, ...rest }: TrackedLinkProps) {
  return (
    <a
      {...rest}
      onClick={(e) => {
        trackEvent(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
