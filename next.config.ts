import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Routes stay TypeScript. MDX and Markdown files are imported from content/.
  pageExtensions: ["ts", "tsx"],
  poweredByHeader: false,
  // Do not let `next dev` write AGENTS.md and CLAUDE.md into the repo.
  agentRules: false,
};

const withMDX = createMDX({
  // Row sentences and the setup guide live in content/ as .md and .mdx files.
  extension: /\.mdx?$/,
});

export default withMDX(nextConfig);
