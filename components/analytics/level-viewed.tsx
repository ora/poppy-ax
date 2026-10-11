"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Records the first time each setup level section scrolls into view, once per
 * level per page view. Sections are found by `section[data-level]`. Without
 * JavaScript, or without IntersectionObserver, nothing is recorded.
 */
export function LevelViewed() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const level = Number((entry.target as HTMLElement).dataset.level);
          observer.unobserve(entry.target);
          if (Number.isInteger(level) && !seen.has(level)) {
            seen.add(level);
            trackEvent("setup_level_viewed", { level });
          }
        }
      },
      { threshold: 0.2 },
    );
    document.querySelectorAll("section[data-level]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return null;
}
