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

  it("states the problem in the owner's words, citing Sierra's announcement", () => {
    const problem = homeContent.story.beats.find((beat) => beat.id === "problem");
    const parts = textParts(problem?.paragraphs.join(" ") ?? "");
    expect(parts.map((part) => part.text).join("")).toBe(
      "Your customers' assistants already use your site the way people do: loading pages, clicking through forms, and when that fails, calling your support line. It's slow, and the task often fails.",
    );
    expect(parts).toContainEqual({
      text: "It's slow, and the task often fails.",
      href: "https://sierra.ai/blog/introducing-personal-agent-protocol",
    });
  });

  it("makes no claim that assistants ask for passwords", () => {
    const problem = homeContent.story.beats.find((beat) => beat.id === "problem");
    expect(problem?.paragraphs.join(" ")).not.toMatch(/password/i);
    // The one password line left is the spec-backed one about signing in on the company's own page.
    expect(raw.match(/password/gi)).toHaveLength(1);
    expect(raw).toContain("When people sign in on your own page, they never give their password to an assistant.");
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
