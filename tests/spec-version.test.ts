import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import audit from "@/content/audit.json";
import home from "@/content/home.json";
import setup from "@/content/setup/index.json";
import catalog from "@/fixtures/catalog.json";
import { content } from "@/lib/content";

// Two versions are in play. The guide explains the spec draft the authors ask
// builders to use (draft 1.0, named in the draft line in content/site.json),
// and the checker shows Ora's results, which grade the draft named in the
// recorded catalog's `profile` (such as "pap-0.3@2026-11-09": the version and
// the day Ora read it). Every line that names the guide's draft has to agree
// with the draft line, and every line that says what the checker grades has to
// agree with the catalog. When Ora moves to a new draft, the weekly spec drift
// watch opens an issue, the catalog is recorded again, and this test fails
// until the checker notes catch up.

const PROFILE = /^pap-(\d+\.\d+)@(\d{4}-\d{2}-\d{2})$/;
const DRAFT_LINE = /^Based on Poppy draft (\d+\.\d+) \(read (\d{4}-\d{2}-\d{2})\)$/;

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("the draft the guide follows", () => {
  const match = DRAFT_LINE.exec(content.draft.text);
  const version = match?.[1] ?? "";
  const readOn = match?.[2] ?? "";
  const v = version.replace(".", "\\.");

  it("is named in the draft line, which links its spec", () => {
    expect(match, `content/site.json has an unexpected draft line: ${content.draft.text}`).not.toBeNull();
    expect(content.draft.href).toBe(`https://personalagentprotocol.org/docs/${version}/spec`);
  });

  it("is the one the home page, /learn and the README name", () => {
    expect(home.status).toContain(`Draft ${version},`);
    const learn = read("content/learn.mdx");
    expect(learn).toContain(`[Read the official spec](https://personalagentprotocol.org/docs/${version}/spec), draft ${version},`);
    // "Draft 1.0 is the version the authors ask builders to use, and this guide follows it."
    expect(/Draft (\d+\.\d+)[^.]*this guide follows it/.exec(learn)?.[1]).toBe(version);
    const readme = read("README.md");
    expect(readme).toMatch(new RegExp(`Every page is based on \\[PAP draft ${v}\\]\\(https://personalagentprotocol\\.org/docs/${v}/spec\\) \\(read ${readOn}\\)`));
    expect(readme).toMatch(new RegExp(`checked against the spec, draft ${v} \\(read ${readOn}\\)`));
  });

  it("is the one every setup level links", () => {
    for (const level of ["level-1", "level-2", "level-3", "level-4"]) {
      const text = read(`content/setup/${level}.mdx`);
      const versions = new Set([...text.matchAll(/personalagentprotocol\.org\/docs\/(\d+\.\d+)\//g)].map((m) => m[1]));
      expect([...versions], level).toEqual([version]);
    }
  });
});

describe("the draft the checker grades", () => {
  const match = PROFILE.exec(catalog.profile);
  const version = match?.[1] ?? "";

  it("is read from the recorded catalog", () => {
    expect(match, `fixtures/catalog.json has an unexpected profile: ${catalog.profile}`).not.toBeNull();
    expect(catalog.spec_version).toBe(version);
  });

  it("is the one /setup, the result page, /learn and the README say the checker grades", () => {
    expect(setup.page.checksIntro).toContain(`The checker grades Draft ${version},`);
    expect(audit.notChecked.intro).toContain(`The checks that ran grade Draft ${version}.`);
    expect(read("content/learn.mdx")).toContain(`Ora's checker grades Draft ${version}`);
    expect(read("README.md")).toContain(`Ora's checks grade Draft ${version}`);
  });

  it("is the version the weekly watch compares with Ora's live catalog", () => {
    const watch = JSON.parse(read("spec-watch.json"));
    expect(watch.standards[0].sources[0]).toMatchObject({ kind: "json-field", url: "https://ora.ai/pap/catalog.json", field: "profile" });
    expect(watch.standards[0].sources[0].pin).toBe(catalog.profile);
  });

  it("passes the drift script's own manifest check, so the weekly run cannot reject it", async () => {
    // A path the type checker does not follow: the script is plain JavaScript with no types.
    const script = join(process.cwd(), "scripts", "spec-drift.mjs");
    const { validateManifest } = await import(script);
    expect(validateManifest(JSON.parse(read("spec-watch.json")))).toEqual([]);
  });
});
