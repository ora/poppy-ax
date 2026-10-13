import { describe, expect, it } from "vitest";
import audit from "@/content/audit.json";
import verdict from "@/content/verdict.json";

/** Every string value in a content file, with the path to it. Keys are code and are left out. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key));
  }
  return [];
}

// The checker's own terms. The page says "Public file", "Safety checks",
// "Must fix" and "Should fix"; the codes stay in the data and the CSS.
const CHECKER_TERMS = /\b(Tier|P[0-3]|Adv)\b/;

describe("result page words", () => {
  it.each([
    ["content/audit.json", audit],
    ["content/verdict.json", verdict],
  ])("%s never shows a tier or severity code", (_name, content) => {
    const found = strings(content).filter(([, text]) => CHECKER_TERMS.test(text));
    expect(found).toEqual([]);
  });

  it("reads one of four plain states", () => {
    expect(new Set(Object.values(verdict.headlines))).toEqual(
      new Set(["Ready", "Partly ready", "Not yet", "Couldn't check"]),
    );
  });

  it("names every severity in words", () => {
    expect(audit.verdict.severity).toEqual({ P0: "Must fix", P1: "Should fix", P2: "Nice to fix", Adv: "Advice" });
  });

  it("shows owner checks as not turned on, never as failed", () => {
    expect(audit.notChecked.groups["2b"].title).toBe("Owner checks (optional)");
    expect(audit.notChecked.groups["2b"].status).toBe("Not turned on");
  });

  it("contains no em dashes", () => {
    for (const [path, text] of [...strings(audit), ...strings(verdict)]) {
      expect(text, path).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
