import { ImageResponse } from "next/og";
import { content } from "@/lib/content";

// The preview image for every page without its own (the home page, /setup,
// /sites). Result pages draw theirs in app/audit/[domain]/opengraph-image.tsx.
// Nothing in it changes between builds, so Next makes it once at build time.
export const alt = content.metadata.image.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// next/og cannot read CSS variables, so the light palette of app/globals.css
// is copied here, as in the result image. Keep them in step.
const c = {
  /** --paper-light */
  paper: "#f4f6f0",
  /** --ink-light */
  ink: "#16211b",
  /** --ink-muted-light */
  muted: "#4b5750",
  /** --poppy-light */
  poppy: "#c42118",
} as const;

export default function Image() {
  const image = content.metadata.image;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: c.paper,
          color: c.ink,
          borderTop: `16px solid ${c.poppy}`,
        }}
      >
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" }}>
          poppy<span style={{ color: c.poppy }}>.</span>ax
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 80, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: 1000 }}>
            {image.heading}
          </div>
          <div style={{ display: "flex", fontSize: 40, color: c.muted, marginTop: 24 }}>{image.line}</div>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: c.muted }}>{content.draft.text}</div>
      </div>
    ),
    size,
  );
}
