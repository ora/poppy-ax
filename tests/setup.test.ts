import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "@/fixtures/catalog.json";
import { catalogRow, groupedRows, setupContent } from "@/lib/setup";
import { SPEC_ANCHORS } from "./spec-anchors";

const SETUP_DIR = join(__dirname, "..", "content", "setup");
const files = readdirSync(SETUP_DIR).filter((name) => /\.(mdx?|json)$/.test(name));
const mdxFiles = files.filter((name) => name.endsWith(".mdx"));
const read = (name: string) => readFileSync(join(SETUP_DIR, name), "utf8");

/** Markdown links as [text, url] pairs. */
function links(source: string): [string, string][] {
  return [...source.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => [m[1] ?? "", m[2] ?? ""]);
}

/** The MDX source with fenced code blocks removed. */
function withoutCode(source: string): string {
  return source.replace(/^```[\s\S]*?^```/gm, "");
}

describe("content/setup/index.json", () => {
  it("has the four levels in order, each with an MDX file", () => {
    expect(setupContent.levels.map((level) => level.id)).toEqual(["level-1", "level-2", "level-3", "level-4"]);
    for (const level of setupContent.levels) {
      expect(mdxFiles).toContain(`${level.id}.mdx`);
    }
  });

  it("lists at least one row per level, and every row exists in fixtures/catalog.json", () => {
    for (const level of setupContent.levels) {
      expect(level.rows.length, level.id).toBeGreaterThan(0);
      for (const id of level.rows) {
        expect(catalogRow(id), `${level.id} lists ${id}`).toBeDefined();
      }
    }
  });

  it("places every catalog row in exactly one level", () => {
    const listed = setupContent.levels.flatMap((level) => level.rows);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(catalog.rows.map((row) => row.id).sort());
  });

  it("puts only Tier 0 rows in level 1", () => {
    const level1 = setupContent.levels[0]!;
    for (const id of level1.rows) expect(catalogRow(id)?.level, id).toBe("0");
  });

  it("puts every browser, conversation and operations row in level 4, and nothing else", () => {
    const level4 = new Set(setupContent.levels[3]!.rows);
    // A row belongs to an optional surface when its spec section is browsing
    // (section 5), a conversation section (7.x) or the operations extension, or
    // when it sends its request to one of those surfaces' endpoints.
    const surfaceAnchors = new Set([
      "web-browsing", "conversation-protocols", "conversation-requests", "sending-messages", "message-fields",
      "reading-events", "streaming", "status", "human-or-ai", "handoff", "direct-conversations",
      "conversation-sign-in", "closing", "conversation-errors",
    ]);
    const surfaceTargets = /conversation endpoint|browser_session_endpoint|operations endpoint/;
    const onSurface = (row: (typeof catalog.rows)[number]) => {
      const url = new URL(row.spec_url);
      return (
        url.pathname === "/docs/extensions/operations" ||
        surfaceAnchors.has(url.hash.slice(1)) ||
        surfaceTargets.test(row.request?.target ?? "")
      );
    };
    // Guides rows have no section anchor; these are about a surface by their title.
    const surfaceByTitle: Record<string, string> = { "T2-25": "Cookie scope (browser join cookie)" };
    for (const row of catalog.rows) {
      if (row.level === "0") continue;
      const expected = onSurface(row) || row.id in surfaceByTitle;
      expect(level4.has(row.id), row.id).toBe(expected);
    }
  });

  it("groups rows the checker runs today first", () => {
    const groups = groupedRows(setupContent.levels[1]!).map((entry) => entry.group);
    expect(groups[0]).toBe("today");
  });

  it("lists what a site owner needs before level 1, in plain words", () => {
    const { needs } = setupContent.page;
    expect(needs.heading).toBe("What you'll need");
    expect(needs.items.length).toBeGreaterThanOrEqual(3);
    expect(needs.items.join(" ")).toContain("poppy.json");
    // OAuth is explained where the page first names it.
    expect(needs.items.find((item) => item.includes("OAuth"))).toContain("the standard behind");
    for (const item of needs.items) expect(item).not.toContain(String.fromCharCode(0x2014));
  });

  it("ends with the one hosted note", () => {
    expect(setupContent.page.hosted.href).toBe("https://ora.ai/pap/managed");
    expect(setupContent.page.hosted.before + setupContent.page.hosted.linkText).toBe(
      "Rather not run a sign-in server yourself? Ora can host Poppy on your domain, with your login, in front of your existing APIs.",
    );
  });
});

describe("content/setup/*.mdx", () => {
  it("links every spec, guides and operations claim to personalagentprotocol.org", () => {
    for (const name of mdxFiles) {
      for (const [text, url] of links(read(name))) {
        if (/^(spec|guides|operations)\b/.test(text)) {
          expect(new URL(url).hostname, `${name}: [${text}]`).toBe("personalagentprotocol.org");
        }
      }
    }
  });

  it("links only to anchors that exist on the spec pages", () => {
    for (const name of mdxFiles) {
      for (const [text, url] of links(read(name))) {
        const parsed = new URL(url);
        if (parsed.hostname !== "personalagentprotocol.org") continue;
        const anchors = SPEC_ANCHORS[parsed.pathname];
        expect(anchors, `${name}: [${text}] ${parsed.pathname}`).toBeDefined();
        expect(anchors, `${name}: [${text}] ${url}`).toContain(parsed.hash.slice(1));
      }
    }
  });

  it("links every level to the spec", () => {
    for (const name of mdxFiles) {
      expect(links(read(name)).some(([, url]) => url.startsWith("https://personalagentprotocol.org/")), name).toBe(true);
    }
  });

  it("uses only h3 and lower, since the page owns h1 and each level's h2", () => {
    for (const name of mdxFiles) {
      expect(withoutCode(read(name)), name).not.toMatch(/^#{1,2} /m);
    }
  });

  it("does not mention Ora, so the guide stands on its own", () => {
    for (const name of mdxFiles) {
      expect(read(name), name).not.toMatch(/\bOra\b|ora\.ai/);
    }
  });

  it("labels Datalayer's tools as pre-beta", () => {
    const withDatalayer = mdxFiles.filter((name) => read(name).includes("Datalayer"));
    expect(withDatalayer.length).toBeGreaterThan(0);
    for (const name of withDatalayer) expect(read(name), name).toContain("pre-beta");
  });
});

describe("content/setup", () => {
  it("contains no em dashes", () => {
    for (const name of files) {
      expect(read(name), name).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
