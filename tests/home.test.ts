import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeContent, textParts } from "@/lib/home";

const raw = readFileSync(join(__dirname, "..", "content", "home.json"), "utf8");

/** A content string as the reader sees it: link text kept, URLs dropped. */
const plain = (source: string) => textParts(source).map((part) => part.text).join("");

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// The reader-facing prose of each section. The picture's labels and its
// description for screen readers are not counted: they repeat the steps.
const { heading, lede, status, check, compare, valetKey, steps, stands } = homeContent;
const sections: Record<string, string> = {
  hero: [heading, lede, status, check.label, check.hint].join(" "),
  compare: [compare.heading, ...compare.columns.flatMap((column) => [column.title, column.text])].join(" "),
  valetKey: [valetKey.heading, valetKey.text].join(" "),
  // Each step is its own card, so each counts as its own section.
  ...Object.fromEntries(steps.items.map((step) => [`step ${step.number}`, `${step.title} ${step.caption}`])),
  stepsHeading: steps.heading,
  stands: [stands.heading, plain(stands.text), ...stands.links.map((link) => link.text)].join(" "),
};

describe("content/home.json", () => {
  it("leads with the valet key, for the business that owns the site", () => {
    expect(heading).toBe("Give your customers' AI assistants a valet key.");
    expect(lede).toMatch(/^Poppy, the Personal Agent Protocol, is a new open standard\./);
  });

  it("has the three numbered steps, each with a caption", () => {
    expect(steps.items.map((step) => [step.number, step.title])).toEqual([
      [1, "Put up a sign"],
      [2, "The assistant introduces itself"],
      [3, "It works within the key"],
    ]);
    for (const step of steps.items) expect(step.caption.length).toBeGreaterThan(0);
    expect(steps.picture.label.length).toBeGreaterThan(0);
  });

  it("compares today with Poppy, in two columns", () => {
    expect(compare.columns.map((column) => column.title)).toEqual(["Today", "With Poppy"]);
  });

  it("says where the draft stands, cites the announcement, and links on", () => {
    expect(plain(stands.text)).toContain("still a draft");
    expect(textParts(stands.text)).toContainEqual({
      text: "Meta and Sierra announced Poppy",
      href: "https://sierra.ai/blog/introducing-personal-agent-protocol",
    });
    expect(stands.links.map((link) => link.href)).toEqual(["/learn", "/setup"]);
  });

  it("keeps the whole page under 350 words, and each section under 60", () => {
    for (const [id, text] of Object.entries(sections)) expect(words(text), id).toBeLessThanOrEqual(60);
    const total = Object.values(sections).reduce((sum, text) => sum + words(text), 0);
    expect(total).toBeLessThanOrEqual(350);
  });

  it("leaves the technical words to /learn and /setup", () => {
    // poppy.json may appear on the picture's door sign, and nowhere else.
    const { picture, ...rest } = steps;
    const { doorSign, label, ...pictureRest } = picture;
    expect(doorSign).toBe("poppy.json");
    expect(label).toContain("poppy.json");
    const text = JSON.stringify({ ...homeContent, steps: { ...rest, picture: pictureRest } });
    const banned = /\b(OAuth|DPoP|JWT|tokens?|endpoints?|issuer|scopes?|MCP|APIs?|OpenAPI|RFC|JSON|secret|sign-in server)\b/i;
    expect(text).not.toMatch(banned);
  });

  it("makes no claim about passwords", () => {
    expect(raw).not.toMatch(/password/i);
  });

  it("says Poppy, never PAP", () => {
    expect(raw).not.toMatch(/\bPAP\b/);
  });

  it("keeps acronyms out of the part above the fold, apart from AI", () => {
    const aboveTheFold = [heading, lede, ...Object.values(check)].join(" ");
    expect(aboveTheFold.replace(/\bAI\b/g, "")).not.toMatch(/\b[A-Z]{2,}\b/);
  });

  it("contains no em dashes", () => {
    expect(raw).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("textParts", () => {
  it("splits Markdown-style links from plain text", () => {
    expect(textParts("Read [the spec](https://example.com/spec) today.")).toEqual([
      { text: "Read " },
      { text: "the spec", href: "https://example.com/spec" },
      { text: " today." },
    ]);
    expect(textParts("No links here.")).toEqual([{ text: "No links here." }]);
  });
});
