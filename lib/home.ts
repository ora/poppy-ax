import home from "@/content/home.json";

export type HomeContent = typeof home;
export type StoryBeat = HomeContent["story"]["beats"][number];
export type Step = HomeContent["steps"]["items"][number];

/** The home page's text, from content/home.json. */
export const homeContent: HomeContent = home;

export type TextPart = { text: string; href?: string };

/**
 * Split a content string into plain text and Markdown-style links, so a
 * sentence in content/ can carry a link: "Read [the spec](https://...)".
 */
export function textParts(source: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of source.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    parts.push({ text: match[1] ?? "", href: match[2] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}
