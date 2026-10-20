import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import home from "@/content/home.json";
import catalog from "@/fixtures/catalog.json";
import { content } from "@/lib/content";

// poppy.ax explains the draft Ora's checks grade. The recorded catalog says
// which one (`profile`, such as "pap-0.2@2026-10-19": the version and the day
// Ora read it), so every line that names the draft the guide follows has to
// agree with it. When Ora moves to a new draft, the weekly spec drift watch
// opens an issue, the catalog is recorded again, and this test fails until the
// prose catches up.

const PROFILE = /^pap-(\d+\.\d+)@(\d{4}-\d{2}-\d{2})$/;

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("the draft poppy.ax follows", () => {
  const match = PROFILE.exec(catalog.profile);
  const version = match?.[1] ?? "";
  const readOn = match?.[2] ?? "";

  it("is read from the recorded catalog", () => {
    expect(match, `fixtures/catalog.json has an unexpected profile: ${catalog.profile}`).not.toBeNull();
    expect(catalog.spec_version).toBe(version);
  });

  it("is the one the draft line, the home page, /learn and the README name", () => {
    expect(content.draft.text).toContain(`Draft ${version} `);
    expect(content.draft.text).toContain(`read ${readOn}`);
    expect(home.status).toContain(`Draft ${version},`);
    expect(read("content/learn.mdx")).toContain(`[Read the official spec](https://personalagentprotocol.org/docs/spec), Draft ${version},`);
    const readme = read("README.md");
    expect(readme).toContain(`Every page is based on [PAP Draft ${version}](https://personalagentprotocol.org/docs/spec)`);
    expect(readme).toContain(`read ${readOn}`);
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
