import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CONTENT = join(__dirname, "..", "content");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(json|mdx?)$/.test(name) ? [path] : [];
  });
}

// "PAP" is how much of the press spells it, so it stays as a search alias in
// metadata, plus one plain line on /learn. Everything a reader sees says Poppy.
const ALLOWED = [
  { file: "site.json", line: /"description": "Poppy, the Personal Agent Protocol \(also called PAP\)/ },
  { file: "site.json", line: /"keywords": \[/ },
  { file: "audit.json", line: /"checkDescription": / },
  { file: "learn.mdx", line: /Some news coverage calls it PAP\./ },
];

describe("naming", () => {
  it("says Poppy in every reader-facing string, with PAP only as an alias", () => {
    const found: string[] = [];
    for (const path of files(CONTENT)) {
      const file = relative(CONTENT, path);
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!/\bPAP\b/.test(line)) return;
          if (ALLOWED.some((allowed) => allowed.file === file && allowed.line.test(line))) return;
          found.push(`${file}:${index + 1}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("uses the /learn alias line exactly once", () => {
    const learn = readFileSync(join(CONTENT, "learn.mdx"), "utf8");
    expect(learn.match(/\bPAP\b/g)).toHaveLength(1);
  });
});
