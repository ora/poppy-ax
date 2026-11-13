import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

// What both share images (app/opengraph-image.tsx and
// app/audit/[domain]/opengraph-image.tsx) draw with: the site's own faces,
// its light palette and its brand chrome. next/og cannot read CSS variables
// or next/font, so the colors are copied from app/globals.css, each named by
// its token, and the faces are read from assets/fonts. Keep them in step.

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const ogColor = {
  /** --paper-light */
  paper: "#f4f6f0",
  /** --surface-light */
  surface: "#e9ede3",
  /** --card-light */
  card: "#fbfcf8",
  /** --ink-light */
  ink: "#16211b",
  /** --ink-muted-light */
  muted: "#4b5750",
  /** --rule-light */
  rule: "#cdd3c8",
  /** --poppy-light */
  poppy: "#c42118",
  /** --poppy-soft-light */
  poppySoft: "#fbe8e3",
  /** --leaf-light */
  leaf: "#1b6a41",
  /** --leaf-soft-light */
  leafSoft: "#e2efe4",
} as const;

/** The display face is Besley, as on the site; Inter for everything else. */
export const OG_DISPLAY = "Besley";
const OG_BODY = "Inter";

function font(file: string): Buffer {
  return readFileSync(join(process.cwd(), "assets", "fonts", file));
}

/** The faces, read once per server. Besley and Inter are under the OFL (assets/fonts/OFL.txt). */
type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
};
let fonts: OgFont[] | undefined;
export function ogFonts(): OgFont[] {
  fonts ??= [
    {
      name: OG_DISPLAY,
      data: font("Besley-Bold.woff"),
      weight: 700,
      style: "normal",
    },
    {
      name: OG_BODY,
      data: font("Inter-Regular.woff"),
      weight: 400,
      style: "normal",
    },
    {
      name: OG_BODY,
      data: font("Inter-SemiBold.woff"),
      weight: 600,
      style: "normal",
    },
  ];
  return fonts;
}

/** The site's mark: a "p" and the poppy-red dot on an ink tile, as in the icons. */
function Mark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: ogColor.ink,
        borderRadius: size * 0.24,
        color: ogColor.paper,
        fontFamily: OG_DISPLAY,
        fontSize: size * 0.72,
        fontWeight: 700,
        lineHeight: 1,
        paddingBottom: size * 0.1,
      }}
    >
      p<span style={{ color: "#ff6b57" }}>.</span>
    </div>
  );
}

/**
 * The frame both images share: pale field paper with a soft poppy glow, the
 * mark and wordmark top left, the byline top right, and `children` below.
 */
export function OgFrame({ byline, children }: { byline: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "56px 72px",
        backgroundColor: ogColor.paper,
        backgroundImage:
          "radial-gradient(circle at 92% 8%, rgba(196, 33, 24, 0.16), rgba(196, 33, 24, 0) 46%), radial-gradient(circle at 0% 100%, rgba(27, 106, 65, 0.10), rgba(27, 106, 65, 0) 42%)",
        color: ogColor.ink,
        fontFamily: OG_BODY,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <Mark size={52} />
          <div
            style={{
              display: "flex",
              marginLeft: 18,
              fontFamily: OG_DISPLAY,
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            poppy<span style={{ color: ogColor.poppy }}>.</span>ax
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: ogColor.muted }}>{byline}</div>
      </div>
      {children}
    </div>
  );
}

/** A small label with a colored dot, such as the draft line. */
export function OgPill({ children, dot = ogColor.poppy }: { children: ReactNode; dot?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        alignSelf: "flex-start",
        padding: "10px 20px",
        borderRadius: 999,
        backgroundColor: ogColor.card,
        border: `1.5px solid ${ogColor.rule}`,
        fontSize: 22,
        color: ogColor.muted,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: dot,
          marginRight: 12,
        }}
      />
      {children}
    </div>
  );
}
