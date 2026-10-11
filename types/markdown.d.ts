// Markdown files in content/ compile through @next/mdx like .mdx files.
declare module "*.md" {
  import type { MDXProps } from "mdx/types";
  import type { JSX } from "react";

  export default function MDXContent(props: MDXProps): JSX.Element;
}

// TypeScript 6 no longer loads every @types package by itself, so the `*.mdx`
// declaration from @types/mdx is restated here for the setup guide's levels.
declare module "*.mdx" {
  import type { MDXProps } from "mdx/types";
  import type { JSX } from "react";

  export default function MDXContent(props: MDXProps): JSX.Element;
}
