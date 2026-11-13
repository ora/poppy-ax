import { ImageResponse } from "next/og";
import { content } from "@/lib/content";
import { OG_DISPLAY, OG_SIZE, OgFrame, OgPill, ogColor as c, ogFonts } from "@/lib/og";

// The preview image for every page without its own (the home page, /learn,
// /setup, /sites). Result pages draw theirs in app/audit/[domain]/opengraph-image.tsx.
// Nothing in it changes between builds, so Next makes it once at build time.
// The card on the right is the idea in one picture: the person approves some
// kinds of access for their assistant and leaves others out.
export const alt = content.metadata.image.alt;
export const size = OG_SIZE;
export const contentType = "image/png";

function Toggle({ on }: { on: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        width: 52,
        height: 30,
        borderRadius: 15,
        padding: 3,
        justifyContent: on ? "flex-end" : "flex-start",
        backgroundColor: on ? c.leaf : c.rule,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: c.card,
        }}
      />
    </div>
  );
}

function ConsentCard() {
  const card = content.metadata.image.card;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 470,
        padding: "30px 32px",
        borderRadius: 24,
        backgroundColor: c.card,
        border: `1.5px solid ${c.rule}`,
        boxShadow: "0 24px 60px rgba(22, 33, 27, 0.16), 0 4px 12px rgba(22, 33, 27, 0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 24,
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        {card.title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>
        {card.scopes.map((scope) => (
          <div
            key={scope.text}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 0",
              borderTop: `1.5px solid ${c.surface}`,
              fontSize: 22,
              color: scope.allowed ? c.ink : c.muted,
            }}
          >
            <div style={{ display: "flex", maxWidth: 330 }}>{scope.text}</div>
            <Toggle on={scope.allowed} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            flexGrow: 1,
            justifyContent: "center",
            padding: "14px 0",
            borderRadius: 12,
            backgroundColor: c.poppy,
            color: c.paper,
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          {card.allow}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "14px 24px",
            marginLeft: 12,
            borderRadius: 12,
            border: `1.5px solid ${c.rule}`,
            color: c.muted,
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          {card.decline}
        </div>
      </div>
    </div>
  );
}

export default function Image() {
  const image = content.metadata.image;
  return new ImageResponse(
    <OgFrame byline={image.byline}>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 540 }}>
          <div
            style={{
              display: "flex",
              fontFamily: OG_DISPLAY,
              fontSize: 58,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.015em",
            }}
          >
            {image.heading}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              lineHeight: 1.35,
              color: c.muted,
              marginTop: 22,
            }}
          >
            {image.line}
          </div>
          <div style={{ display: "flex", marginTop: 34 }}>
            <OgPill>{content.draft.text}</OgPill>
          </div>
        </div>
        <ConsentCard />
      </div>
    </OgFrame>,
    { ...OG_SIZE, fonts: ogFonts() },
  );
}
