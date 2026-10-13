import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPEC_ANCHORS } from "./spec-anchors";

const learn = readFileSync(join(__dirname, "..", "content", "learn.mdx"), "utf8");

/** Markdown links as [text, url] pairs. */
const links = [...learn.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => [m[1] ?? "", m[2] ?? ""] as const);

// Pages on personalagentprotocol.org that /learn links whole, without a section.
const WHOLE_PAGES = new Set(["/docs/spec", "/docs/open-topics"]);

describe("content/learn.mdx", () => {
  it("has the sections the home page sends readers to", () => {
    const headings = [...learn.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "What Poppy is",
      "The problem it solves",
      "How it works",
      "What changes",
      "Where it stands",
      "Words to know",
      "Often mixed up with",
      "For developers",
    ]);
  });

  it("links only to sections that exist on the spec pages", () => {
    for (const [text, url] of links) {
      if (!url.startsWith("http")) continue;
      const parsed = new URL(url);
      if (parsed.hostname !== "personalagentprotocol.org") continue;
      if (!parsed.hash) {
        expect(WHOLE_PAGES, `[${text}] ${url}`).toContain(parsed.pathname);
        continue;
      }
      expect(SPEC_ANCHORS[parsed.pathname], `[${text}] ${url}`).toContain(parsed.hash.slice(1));
    }
  });

  it("links the site's own pages that exist", () => {
    const local = links.map(([, url]) => url).filter((url) => url.startsWith("/"));
    expect(new Set(local)).toEqual(new Set(["/sites", "/setup"]));
  });

  it("never says passwords are never shared without naming mediated sign-in", () => {
    expect(learn).toContain("never sees their password");
    expect(learn).toContain("#mediated-sign-in");
  });

  it("contains no em dashes", () => {
    expect(learn).not.toContain(String.fromCharCode(0x2014));
  });
});
