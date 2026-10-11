import { ImageResponse } from "next/og";
import { auditContent, imageCacheControl, imageCard, resolveAuditParam } from "@/lib/audit";
import { content } from "@/lib/content";
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
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// next/og cannot read CSS variables, so the light palette of app/globals.css
// is copied here, each value named by its token. Keep them in step.
const c = {
  /** --paper-light */
  paper: "#f4f6f0",
  /** --ink-light */
  ink: "#16211b",
  /** --ink-muted-light */
  muted: "#4b5750",
  /** --rule-light */
  rule: "#cdd3c8",
  /** --poppy-light */
  poppy: "#c42118",
} as const;

export default async function Image({ params }: { params: Promise<{ domain: string }> }) {
  const param = resolveAuditParam((await params).domain);
  const domain = param.kind === "invalid" ? null : param.domain;
  const [result, catalog] = await Promise.all([
    domain ? getSummary(domain) : Promise.resolve(null),
    getCatalog().then((catalog) => catalog ?? fixtureCatalog),
  ]);
  const card = imageCard(param, result, catalog);

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
          borderTop: `16px solid ${card.kind === "result" ? c[card.accent] : c.poppy}`,
        }}
      >
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" }}>
          poppy<span style={{ color: c.poppy }}>.</span>ax
        </div>

        {card.kind === "result" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 44, color: c.muted }}>{card.domain}</div>
            <div
              style={{
                display: "flex",
                fontSize: 92,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                color: c[card.accent],
                marginTop: 12,
              }}
            >
              {card.headline}
            </div>
          </div>
        )}
        {card.kind === "check" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 88, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
              {card.title}
            </div>
            <div style={{ display: "flex", fontSize: 40, color: c.muted, marginTop: 20 }}>{card.subtitle}</div>
          </div>
        )}
        {card.kind === "neutral" && (
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1, maxWidth: 900 }}>
            {card.title}
          </div>
        )}

        {card.kind === "result" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingTop: 24,
              borderTop: `2px solid ${c.rule}`,
              fontSize: 30,
              color: c.muted,
            }}
          >
            {card.tiers.map((tier) => (
              <div key={tier.label} style={{ display: "flex" }}>
                <span style={{ color: c.ink, fontWeight: 700, marginRight: 16 }}>{tier.label}</span>
                {tier.text}
              </div>
            ))}
            <div style={{ display: "flex" }}>
              <span style={{ color: c.ink, fontWeight: 700, marginRight: 16 }}>{auditContent.verdict.profile}</span>
              {card.profile}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 30, color: c.muted }}>{content.draft.text}</div>
        )}
      </div>
    ),
    {
      ...size,
      headers: { "cache-control": imageCacheControl(result) },
    },
  );
}
