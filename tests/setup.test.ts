import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "@/fixtures/catalog.json";
import { catalogRow, groupedRows, setupContent } from "@/lib/setup";

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

// Heading anchors on the live pages of PAP Draft 0.1 (2026-10-09). A link to
// any other anchor lands at the top of the page instead of the section.
const SPEC_ANCHORS: Record<string, string[]> = {
  "/docs/spec": [
    "intro", "terms", "discovery", "fields", "oauth-server", "extensions", "sessions", "agent-identity",
    "starting-sessions", "sending-tokens", "sign-in", "direct-sign-in", "device-sign-in", "mediated-sign-in",
    "account-tokens", "sign-out", "web-browsing", "apis", "conversations", "conversation-protocols",
    "conversation-requests", "sending-messages", "message-fields", "reading-events", "streaming", "status",
    "human-or-ai", "handoff", "direct-conversations", "conversation-sign-in", "closing", "conversation-errors",
    "references",
  ],
  "/docs/extensions/operations": [
    "intro", "support", "operations", "revisions", "ownership", "proposing", "binding-openapi", "binding-mcp",
    "binding-conversations", "binding-web", "confirming", "approval", "confirm", "tracking", "cancelling",
    "proof", "errors",
  ],
  "/docs/guides": [
    "about", "both", "both-secrets", "both-signing", "both-key-rotation", "both-fetching", "both-retries",
    "both-rate-limits", "both-transport", "agents", "agent-user-ids", "agent-dpop", "agent-tokens",
    "agent-choosing-sign-in", "agent-direct-device", "agent-mediated", "agent-native-apps", "agent-browsing",
    "agent-conversations", "agent-interfaces", "companies", "company-agents", "company-dpop",
    "company-lifetimes", "company-consent", "company-device", "company-mediated", "company-account-settings",
    "company-browsing", "company-scopes", "company-internal", "company-guest", "company-conversations",
    "company-errors", "operations", "operations-agents", "operations-companies",
  ],
};

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

  it("puts every browser, conversation and operations row in level 4", () => {
    const level4 = new Set(setupContent.levels[3]!.rows);
    const surfaceAnchors = new Set(SPEC_ANCHORS["/docs/spec"]!.slice(SPEC_ANCHORS["/docs/spec"]!.indexOf("web-browsing")));
    surfaceAnchors.delete("apis");
    surfaceAnchors.delete("conversations");
    surfaceAnchors.delete("references");
    for (const row of catalog.rows) {
      if (row.level === "0") continue;
      const url = new URL(row.spec_url);
      const onSurface = url.pathname === "/docs/extensions/operations" || surfaceAnchors.has(url.hash.slice(1));
      if (onSurface) expect(level4.has(row.id), row.id).toBe(true);
    }
  });

  it("groups rows the checker runs today first", () => {
    const groups = groupedRows(setupContent.levels[1]!).map((entry) => entry.group);
    expect(groups[0]).toBe("today");
  });

  it("ends with the one hosted note", () => {
    expect(setupContent.page.hosted.href).toBe("https://ora.ai/pap/managed");
    expect(setupContent.page.hosted.before + setupContent.page.hosted.linkText).toBe(
      "Rather not run an issuer yourself? Ora can host PAP on your domain, with your login, in front of your existing APIs.",
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
