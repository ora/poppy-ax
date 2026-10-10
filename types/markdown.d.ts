// Markdown files in content/ compile through @next/mdx like .mdx files.
declare module "*.md" {
  import type { MDXProps } from "mdx/types";
  import type { JSX } from "react";

  export default function MDXContent(props: MDXProps): JSX.Element;
}
