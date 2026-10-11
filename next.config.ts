import createMDX from "@next/mdx";
import type { NextConfig } from "next";

/** The recorded Ora responses that fixture mode reads at runtime. */
const ORA_FIXTURE_FILES = ["./fixtures/*.json", "./fixtures/*.sse", "./fixtures/errors/*.json"];

/** Sent on /audit and every page under it. */
const AUDIT_FRAME_POLICY = { key: "Content-Security-Policy", value: "frame-ancestors 'none'" };

const nextConfig: NextConfig = {
  // Routes stay TypeScript. MDX and Markdown files are imported from content/.
  pageExtensions: ["ts", "tsx"],
  poweredByHeader: false,
  // Do not let `next dev` write AGENTS.md and CLAUDE.md into the repo.
  agentRules: false,
  // lib/rows.ts reads content/rows/*.md from disk when the result page
  // renders, and lib/ora/fixtures.ts reads fixtures/ in fixture mode
  // (ORA_FIXTURES=1, used by previews), so the deployed functions that use
  // them must ship those files.
  outputFileTracingIncludes: {
    // The keys are globs over route paths, so the brackets are escaped.
    "/audit/\\[domain\\]": ["./content/rows/*.md", ...ORA_FIXTURE_FILES],
    "/audit/\\[domain\\]/opengraph-image": ["./content/rows/*.md", ...ORA_FIXTURE_FILES],
    "/sites": ORA_FIXTURE_FILES,
    "/api/check/\\[domain\\]": ORA_FIXTURE_FILES,
  },
  // Result pages are never framed by another site, so a click cannot be
  // tricked into starting a check (clickjacking).
  async headers() {
    return [
      { source: "/audit", headers: [AUDIT_FRAME_POLICY] },
      { source: "/audit/:path*", headers: [AUDIT_FRAME_POLICY] },
    ];
  },
};

const withMDX = createMDX({
  // Row sentences and the setup guide live in content/ as .md and .mdx files.
  extension: /\.mdx?$/,
});

export default withMDX(nextConfig);
