import site from "@/content/site.json";

export type Site = typeof site;

/** All page shell text. Components read from here, never from literals. */
export const content: Site = site;

/** The independent label as one plain sentence, for tests and metadata. */
export function independentLabelText(c: Site = content): string {
  const { before, linkText, after } = c.independentLabel;
  return `${before}${linkText}${after}`;
}
