// The site's mark for icons: a "p" and the poppy-red dot on the ink tile.
// next/og cannot read CSS variables, so the colors are copied from
// app/globals.css (--ink-light, --paper-light, --poppy-light), as in the
// share images. Keep them in step.
export function BrandMark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#16211b",
        borderRadius: size * 0.2,
        color: "#f4f6f0",
        fontSize: size * 0.78,
        fontWeight: 700,
        lineHeight: 1,
        paddingBottom: size * 0.12,
      }}
    >
      p<span style={{ color: "#c42118" }}>.</span>
    </div>
  );
}
