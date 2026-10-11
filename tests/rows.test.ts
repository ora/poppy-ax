import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import setup from "@/content/setup/index.json";
import {
  createRowContentLoader,
  fixtureCatalog,
  parseRowFile,
  ROW_CONTENT_DIR,
  ROW_CONTENT_KEYS,
  ROW_CONTENT_OPTIONAL_KEYS,
  rowContent,
} from "@/lib/rows";
import { stepId } from "@/lib/setup";

const files = readdirSync(ROW_CONTENT_DIR).filter((name) => name.endsWith(".md"));
const fileIds = files.map((name) => name.replace(/\.md$/, ""));
const catalogIds = fixtureCatalog.rows.map((row) => row.id);
const read = (id: string) => readFileSync(join(ROW_CONTENT_DIR, `${id}.md`), "utf8");
const parsed = new Map(fileIds.map((id) => [id, parseRowFile(read(id))]));
const values = (id: string) => Object.values(parsed.get(id)?.data ?? {});

// The ids the setup page renders as anchors (components/setup-level.tsx): each
// level, its title and checks list, and each step's h3 heading in its MDX file.
const SETUP_DIR = join(__dirname, "..", "content", "setup");
const stepHeadings = (levelId: string) =>
  [...readFileSync(join(SETUP_DIR, `${levelId}.mdx`), "utf8").matchAll(/^### (.+)$/gm)].map((m) => (m[1] ?? "").trim());
const stepAnchors = setup.levels.flatMap((level) => stepHeadings(level.id).map((heading) => stepId(level.id, heading)));
const setupAnchors = new Set([
  ...setup.levels.flatMap((level) => [level.id, `${level.id}-title`, `${level.id}-checks`]),
  ...stepAnchors,
]);
const ALLOWED_KEYS = new Set<string>([...ROW_CONTENT_KEYS, ...ROW_CONTENT_OPTIONAL_KEYS]);

describe("content/rows", () => {
  it("has a content file for every catalog row", () => {
    const missing = catalogIds.filter((id) => !fileIds.includes(id));
    expect(missing, `catalog rows with no content/rows/<id>.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no content file for a row the catalog does not list", () => {
    const orphans = fileIds.filter((id) => !catalogIds.includes(id));
    expect(orphans, `content/rows files not in the catalog: ${orphans.join(", ")}`).toEqual([]);
  });

  it("gives every file front matter with every key filled in", () => {
    const problems: string[] = [];
    for (const id of fileIds) {
      const front = parsed.get(id);
      if (!front) {
        problems.push(`${id}: no front matter`);
        continue;
      }
      for (const key of ROW_CONTENT_KEYS) {
        if (!front.data[key]?.trim()) problems.push(`${id}: missing ${key}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("links each row to its own spec section from the catalog", () => {
    for (const row of fixtureCatalog.rows) {
      const front = parsed.get(row.id);
      if (!front) continue;
      expect(front.data.spec_section, row.id).toBe(row.spec_url);
    }
  });

  it("gives every setup step heading a unique id", () => {
    expect(stepAnchors.length).toBeGreaterThan(20);
    expect(new Set(stepAnchors).size).toBe(stepAnchors.length);
    expect(stepAnchors).toContain("level-1-name-your-sign-in-server");
  });

  it("links each row to an anchor the setup page renders", () => {
    const broken: string[] = [];
    for (const id of fileIds) {
      const step = parsed.get(id)?.data.setup_step ?? "";
      const anchor = /^\/setup#([\w-]+)$/.exec(step)?.[1];
      if (!anchor || !setupAnchors.has(anchor)) broken.push(`${id}: ${step}`);
    }
    expect(broken, `setup_step links that do not resolve:\n${broken.join("\n")}`).toEqual([]);
  });

  it("links each row to the step that fixes it, not just its level", () => {
    const levelOnly = fileIds.filter((id) => /^\/setup#level-\d$/.test(parsed.get(id)?.data.setup_step ?? ""));
    expect(levelOnly, `rows linked only to a level: ${levelOnly.join(", ")}`).toEqual([]);
  });

  it("writes every front matter value as a double-quoted string on one line, with known keys only", () => {
    const problems: string[] = [];
    for (const id of fileIds) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(read(id))?.[1] ?? "";
      for (const line of front.split("\n")) {
        const match = /^([a-z_]+): (".*")$/.exec(line);
        if (!match) {
          problems.push(`${id}: not key: "value": ${line}`);
          continue;
        }
        const [, key = "", raw = ""] = match;
        if (!ALLOWED_KEYS.has(key)) problems.push(`${id}: unknown key ${key}`);
        try {
          if (typeof JSON.parse(raw) !== "string") problems.push(`${id}: ${key} is not a string`);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          problems.push(`${id}: ${key} is not a valid quoted string`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("shows no row title that mentions Ora", () => {
    const named = catalogIds.filter((id) => /\bOra\b/i.test(rowContent(id).title));
    expect(named, `row titles naming Ora: ${named.join(", ")}`).toEqual([]);
  });

  it("describes a planned check as planned, and a check that runs today as a finding", () => {
    for (const row of fixtureCatalog.rows) {
      const what = parsed.get(row.id)?.data.what_failed ?? "";
      if (row.implemented) expect(what, row.id).not.toMatch(/^Planned\b|\bwill\b/);
      else expect(what, row.id).toMatch(/^Planned\. (?:.* )?[Tt]his check will /);
    }
  });

  it("writes plain text: no HTML, Markdown links, code marks or emphasis in the front matter", () => {
    for (const id of fileIds) {
      for (const value of values(id)) {
        expect(value, id).not.toMatch(/[<>`*]|\]\(/);
      }
    }
  });

  it("keeps each line short enough to read at a glance", () => {
    for (const id of fileIds) {
      const front = parsed.get(id);
      for (const key of ["what_failed", "why_it_matters"] as const) {
        expect(front?.data[key]?.length ?? 0, `${id} ${key}`).toBeLessThanOrEqual(400);
      }
    }
  });

  it("contains no em dashes", () => {
    for (const id of fileIds) expect(read(id), id).not.toContain(String.fromCharCode(0x2014));
  });

  it("does not mention Ora", () => {
    for (const id of fileIds) expect(read(id), id).not.toMatch(/\bOra\b|ora\.ai/i);
  });
});

describe("rowContent", () => {
  it("reads a row's file", () => {
    const content = rowContent("T0-01");
    expect(content.source).toBe("file");
    expect(content.title).toBe("Document exists");
    expect(content.what_failed.length).toBeGreaterThan(0);
    expect(content.why_it_matters?.length).toBeGreaterThan(0);
    expect(content.setup_step).toBe("/setup#level-1-publish-one-public-file");
    expect(content.spec_section).toBe("https://personalagentprotocol.org/docs/spec#discovery");
  });

  it("falls back to the catalog title when a row has no file", () => {
    const empty = mkdtempSync(join(tmpdir(), "rows-"));
    const load = createRowContentLoader(empty, fixtureCatalog);
    expect(load("T0-01")).toEqual({
      id: "T0-01",
      title: "Document exists",
      what_failed: "Document exists",
      why_it_matters: null,
      setup_step: "/setup#level-1",
      spec_section: "https://personalagentprotocol.org/docs/spec#discovery",
      body: "",
      source: "fallback",
    });
  });

  it("falls back to the id for a row the catalog does not know", () => {
    const content = rowContent("NOT-A-ROW");
    expect(content.source).toBe("fallback");
    expect(content.what_failed).toBe("NOT-A-ROW");
    expect(content.setup_step).toBe("/setup");
    expect(content.spec_section).toBeNull();
  });

  it("never reads a path outside the folder", () => {
    expect(rowContent("../README").source).toBe("fallback");
    expect(rowContent("T0-01/../../package").source).toBe("fallback");
  });

  it("prefers a title from the file over the catalog title", () => {
    const dir = mkdtempSync(join(tmpdir(), "rows-"));
    writeFileSync(join(dir, "T3-02.md"), '---\ntitle: "A neutral title"\nwhat_failed: "x"\n---\n');
    expect(createRowContentLoader(dir, fixtureCatalog)("T3-02").title).toBe("A neutral title");
    expect(createRowContentLoader(mkdtempSync(join(tmpdir(), "rows-")), fixtureCatalog)("T3-02").title).toBe(
      fixtureCatalog.rows.find((row) => row.id === "T3-02")?.title,
    );
  });

  it("fills a key missing from a file from the catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "rows-"));
    writeFileSync(join(dir, "T0-01.md"), '---\nwhat_failed: "No file."\n---\n\nMore words.\n');
    const content = createRowContentLoader(dir, fixtureCatalog)("T0-01");
    expect(content.source).toBe("file");
    expect(content.what_failed).toBe("No file.");
    expect(content.why_it_matters).toBeNull();
    expect(content.setup_step).toBe("/setup#level-1");
    expect(content.body).toBe("More words.");
  });
});

describe("parseRowFile", () => {
  it("reads quoted and bare values, and the body", () => {
    expect(parseRowFile('---\na: "x: \\"y\\""\nb: plain words\n---\nBody\n')).toEqual({
      data: { a: 'x: "y"', b: "plain words" },
      body: "Body",
    });
  });

  it("returns null without front matter", () => {
    expect(parseRowFile("Just text")).toBeNull();
  });
});
