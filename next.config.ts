import createMDX from "@next/mdx";
import type { NextConfig } from "next";

/** The recorded Ora responses that fixture mode reads at runtime. */
const ORA_FIXTURE_FILES = ["./fixtures/*.json", "./fixtures/*.sse", "./fixtures/errors/*.json"];

/** Sent on every response. */
const SECURITY_HEADERS = [
  // No page is meant to be framed by another site, so a click cannot be
  // tricked into starting a check (clickjacking).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

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
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

const withMDX = createMDX({
  // Row sentences and the setup guide live in content/ as .md and .mdx files.
  extension: /\.mdx?$/,
});

export default withMDX(nextConfig);
