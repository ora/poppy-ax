import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeContent, textParts } from "@/lib/home";

const raw = readFileSync(join(__dirname, "..", "content", "home.json"), "utf8");

describe("content/home.json", () => {
  it("tells the story in four beats, in order", () => {
    expect(homeContent.story.beats.map((beat) => beat.title)).toEqual([
      "The problem",
      "The idea",
      "What changes",
      "Where it stands",
    ]);
    for (const beat of homeContent.story.beats) expect(beat.paragraphs.length, beat.id).toBeGreaterThan(0);
  });

  it("has the three numbered steps, each with a caption", () => {
    expect(homeContent.steps.items.map((step) => [step.number, step.title])).toEqual([
      [1, "Find the door"],
      [2, "Get a key"],
      [3, "Act within the key"],
    ]);
    for (const step of homeContent.steps.items) expect(step.caption.length).toBeGreaterThan(0);
    expect(homeContent.steps.picture.label.length).toBeGreaterThan(0);
  });

  it("has both buttons", () => {
    expect(homeContent.actions.check.text).toBe("Check a site");
    expect(homeContent.actions.setup).toEqual({ text: "Set it up", href: "/setup" });
  });

  it("says where the draft stands, with its two links", () => {
    const stands = homeContent.story.beats.find((beat) => beat.id === "stands");
    const text = stands?.paragraphs.join(" ") ?? "";
    expect(text).toContain("PAP is Draft 0.1, published 2026-10-09.");
    expect(textParts(text)).toContainEqual({
      text: "A reference implementation is promised.",
      href: "https://sierra.ai/blog/introducing-personal-agent-protocol",
    });
    expect(stands && "link" in stands ? stands.link : undefined).toEqual({
      text: "Read the spec",
      href: "https://personalagentprotocol.org/docs/spec",
    });
  });

  it("keeps acronyms out of the part above the fold, apart from AI", () => {
    const aboveTheFold = [homeContent.heading, homeContent.lede, ...Object.values(homeContent.check)].join(" ");
    expect(aboveTheFold.replace(/\bAI\b/g, "")).not.toMatch(/\b[A-Z]{2,}\b/);
  });

  it("explains PAP the first time the story uses it", () => {
    const story = homeContent.story.beats.flatMap((beat) => beat.paragraphs).join(" ");
    expect(story.indexOf("PAP")).toBe(story.indexOf("The Personal Agent Protocol (PAP") + "The Personal Agent Protocol (".length);
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
