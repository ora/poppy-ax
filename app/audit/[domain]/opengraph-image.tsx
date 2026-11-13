import { ImageResponse } from "next/og";
import { auditContent, imageCacheControl, imageCard, resolveAuditParam } from "@/lib/audit";
import { content } from "@/lib/content";
import { OG_DISPLAY, OG_SIZE, OgFrame, OgPill, ogColor as c, ogFonts } from "@/lib/og";
import { getCatalog, getSummary } from "@/lib/ora/client";
import { fixtureCatalog } from "@/lib/rows";

// The preview image for a result: domain, verdict, pass counts and profile.
// Made on request, never stored by Next (any path can be asked for, so
// stored images would grow without bound). Caching is by Cache-Control (see
// imageCacheControl in lib/audit.ts): a result's image as long as its summary
// (60 seconds, Ora's own max-age), shared caches included, and no stale
// copies after that; every other card for a minute in the browser only.
export const dynamic = "force-dynamic";
export const alt = auditContent.image.alt;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ domain: string }> }) {
  const param = resolveAuditParam((await params).domain);
  const domain = param.kind === "invalid" ? null : param.domain;
  const [result, catalog] = await Promise.all([
    domain ? getSummary(domain) : Promise.resolve(null),
    getCatalog().then((catalog) => catalog ?? fixtureCatalog),
  ]);
  const card = imageCard(param, result, catalog);

  // The verdict's accent token (lib/audit.ts) picks a color from the shared palette.
  const accent = card.kind === "result" ? c[card.accent] : c.poppy;

  return new ImageResponse(
    <OgFrame byline={content.metadata.image.byline}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
        }}
      >
        {card.kind === "result" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <OgPill dot={accent}>{card.domain}</OgPill>
            <div
              style={{
                display: "flex",
                fontFamily: OG_DISPLAY,
                fontSize: 88,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.015em",
                color: accent,
                marginTop: 22,
              }}
            >
              {card.headline}
            </div>
          </div>
        )}
        {card.kind === "check" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontFamily: OG_DISPLAY,
                fontSize: 80,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.015em",
              }}
            >
              {card.title}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 34,
                color: c.muted,
                marginTop: 22,
              }}
            >
              {card.subtitle}
            </div>
          </div>
        )}
        {card.kind === "neutral" && (
          <div
            style={{
              display: "flex",
              fontFamily: OG_DISPLAY,
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.015em",
              maxWidth: 900,
            }}
          >
            {card.title}
          </div>
        )}
      </div>

      {card.kind === "result" ? (
        <div
          style={{
            display: "flex",
            borderRadius: 20,
            backgroundColor: c.card,
            border: `1.5px solid ${c.rule}`,
            overflow: "hidden",
            fontSize: 26,
            color: c.muted,
          }}
        >
          <div style={{ display: "flex", width: 10, backgroundColor: accent }} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "22px 28px",
            }}
          >
            {card.tiers.map((tier) => (
              <div key={tier.label} style={{ display: "flex", padding: "3px 0" }}>
                <span style={{ color: c.ink, fontWeight: 600, marginRight: 16 }}>{tier.label}</span>
                {tier.text}
              </div>
            ))}
            <div style={{ display: "flex", padding: "3px 0" }}>
              <span style={{ color: c.ink, fontWeight: 600, marginRight: 16 }}>{auditContent.verdict.profile}</span>
              {card.profile}
            </div>
          </div>
        </div>
      ) : (
        <OgPill>{content.draft.text}</OgPill>
      )}
    </OgFrame>,
    {
      ...OG_SIZE,
      fonts: ogFonts(),
      headers: { "cache-control": imageCacheControl(result) },
    },
  );
}
