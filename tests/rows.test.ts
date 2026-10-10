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
  rowContent,
} from "@/lib/rows";

const files = readdirSync(ROW_CONTENT_DIR).filter((name) => name.endsWith(".md"));
const fileIds = files.map((name) => name.replace(/\.md$/, ""));
const catalogIds = fixtureCatalog.rows.map((row) => row.id);
const read = (id: string) => readFileSync(join(ROW_CONTENT_DIR, `${id}.md`), "utf8");
const parsed = new Map(fileIds.map((id) => [id, parseRowFile(read(id))]));
const values = (id: string) => Object.values(parsed.get(id)?.data ?? {});

// The ids the setup page renders as anchors (components/setup-level.tsx).
const setupAnchors = new Set(setup.levels.flatMap((level) => [level.id, `${level.id}-title`, `${level.id}-checks`]));

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

  it("links each row to a setup anchor the setup page renders, in the level that lists the row", () => {
    for (const id of fileIds) {
      const step = parsed.get(id)?.data.setup_step ?? "";
      const match = /^\/setup#([\w-]+)$/.exec(step);
      expect(match, `${id}: ${step}`).not.toBeNull();
      const anchor = match?.[1] ?? "";
      expect(setupAnchors.has(anchor), `${id}: #${anchor}`).toBe(true);
      const level = setup.levels.find((entry) => entry.rows.includes(id));
      expect(anchor.startsWith(level?.id ?? "no level"), `${id}: #${anchor} is not in ${level?.id}`).toBe(true);
    }
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
    expect(content.setup_step).toBe("/setup#level-1");
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
