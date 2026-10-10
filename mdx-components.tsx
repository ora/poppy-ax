import type { MDXComponents } from "mdx/types";

// Required by @next/mdx in the App Router. Later tasks map headings, links
// and code blocks to site components here.
const components: MDXComponents = {};

export function useMDXComponents(): MDXComponents {
  return components;
}
