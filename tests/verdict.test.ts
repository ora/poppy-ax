import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureCatalog } from "@/lib/rows";
import type { Catalog, CatalogRow, Row, Summary, Verdict } from "@/lib/ora/types";
import { fixFirst, headline, reasonText, unmeasured, verdictContent } from "@/lib/verdict";

function catalogRow(id: string, severity: CatalogRow["severity"], implemented = true): CatalogRow {
  return {
    id,
    tier: 0,
    level: "0",
    severity,
    title: `Title of ${id}`,
    spec_ref: "§3",
    spec_url: "https://personalagentprotocol.org/docs/spec#discovery",
    implemented,
    provisional: !implemented,
    request: null,
    pass_when: null,
    replaces: null,
  };
}

// Catalog order on purpose differs from both id order and severity order.
const catalog: Catalog = {
  rows: [
    catalogRow("A-P1", "P1"),
    catalogRow("B-P0", "P0"),
    catalogRow("C-P2", "P2"),
    catalogRow("D-P1", "P1"),
    catalogRow("E-ADV", "Adv"),
    catalogRow("F-P0", "P0"),
    catalogRow("G-P0-PLANNED", "P0", false),
  ],
};

function row(id: string, outcome: Row["outcome"], extra: Partial<Row> = {}): Row {
  const entry = catalog.rows.find((r) => r.id === id);
  return {
    id,
    tier: 0,
    level: "0",
    severity: entry?.severity ?? "P0",
    outcome,
    reason: null,
    note: null,
    ...extra,
  };
}

const zero = { pass: 0, fail: 0, na: 0, blocked: 0, not_tested: 0 };

function summary(verdict: Verdict, rows: Row[]): Summary {
  return {
    domain: "example.com",
    profile: "pap-0.1@2026-10-09",
    last_run: "2026-10-10T12:00:00Z",
    verdict,
    counts: { tier0: zero, tier1: zero, tier2a: zero, tier2b: zero, tier3: zero },
    rows,
    probed_at: null,
    report_url: "https://ora.ai/pap/example.com",
  };
}

const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id);

describe("fixFirst", () => {
  it("keeps only P0 and P1 failures", () => {
    const s = summary("problems", [
      row("A-P1", "fail"),
      row("B-P0", "pass"),
      row("C-P2", "fail"),
      row("D-P1", "not_tested"),
      row("E-ADV", "fail"),
      row("F-P0", "fail"),
    ]);
    expect(ids(fixFirst(s, catalog))).toEqual(["F-P0", "A-P1"]);
  });

  it("puts P0 first, then follows catalog order, whatever order the summary uses", () => {
    const s = summary("problems", [
      row("F-P0", "fail"),
      row("D-P1", "fail"),
      row("A-P1", "fail"),
      row("B-P0", "fail"),
    ]);
    expect(ids(fixFirst(s, catalog))).toEqual(["B-P0", "F-P0", "A-P1", "D-P1"]);
  });

  it("puts rows the catalog does not know after known ones of the same severity, keeping summary order", () => {
    const s = summary("problems", [
      row("Z-UNKNOWN-P1", "fail", { severity: "P1" }),
      row("Y-UNKNOWN-P0", "fail", { severity: "P0" }),
      row("A-P1", "fail"),
      row("X-UNKNOWN-P0", "fail", { severity: "P0" }),
      row("B-P0", "fail"),
    ]);
    expect(ids(fixFirst(s, catalog))).toEqual(["B-P0", "Y-UNKNOWN-P0", "X-UNKNOWN-P0", "A-P1", "Z-UNKNOWN-P1"]);
  });

  it("joins each row to its catalog entry and title, falling back to the id", () => {
    const s = summary("problems", [row("B-P0", "fail"), row("Q-UNKNOWN", "fail", { severity: "P1" })]);
    const [known, unknown] = fixFirst(s, catalog);
    expect(known?.title).toBe("Title of B-P0");
    expect(known?.catalog?.id).toBe("B-P0");
    expect(known?.row.outcome).toBe("fail");
    expect(unknown?.title).toBe("Q-UNKNOWN");
    expect(unknown?.catalog).toBeUndefined();
  });

  it("is empty when nothing failed", () => {
    expect(fixFirst(summary("working", [row("A-P1", "pass"), row("B-P0", "na")]), catalog)).toEqual([]);
  });
});

describe("unmeasured", () => {
  it("keeps implemented P0 and P1 rows that were not tested or blocked", () => {
    const s = summary("working", [
      row("A-P1", "blocked", { reason: "owner_opt_out" }),
      row("B-P0", "pass"),
      row("C-P2", "not_tested", { reason: "timeout" }),
      row("D-P1", "na"),
      row("E-ADV", "blocked"),
      row("F-P0", "not_tested", { reason: "timeout" }),
      row("G-P0-PLANNED", "not_tested", { reason: "opt_in_required" }),
    ]);
    expect(ids(unmeasured(s, catalog))).toEqual(["F-P0", "A-P1"]);
  });

  it("counts a P0 or P1 row the catalog does not know when it is Tier 0 or 1", () => {
    const s = summary("working", [
      row("Q-UNKNOWN-T0", "not_tested", { severity: "P0", tier: 0, reason: "timeout" }),
      row("R-UNKNOWN-T1", "blocked", { severity: "P1", tier: 1, level: "1" }),
      row("S-UNKNOWN-T2", "not_tested", { severity: "P0", tier: 2, level: "2a", reason: "not_available" }),
      row("T-UNKNOWN-T1-P2", "not_tested", { severity: "P2", tier: 1, level: "1" }),
      row("A-P1", "not_tested", { reason: "timeout" }),
    ]);
    expect(ids(unmeasured(s, catalog))).toEqual(["Q-UNKNOWN-T0", "A-P1", "R-UNKNOWN-T1"]);
    const [unknown] = unmeasured(s, catalog);
    expect(unknown?.title).toBe("Q-UNKNOWN-T0");
    expect(unknown?.catalog).toBeUndefined();
  });

  it("does not count failures as unmeasured", () => {
    expect(unmeasured(summary("problems", [row("B-P0", "fail")]), catalog)).toEqual([]);
  });

  it("explains each row's reason in plain words", () => {
    const s = summary("working", [
      row("B-P0", "not_tested", { reason: "timeout" }),
      row("A-P1", "blocked", { reason: "owner_opt_out" }),
    ]);
    expect(unmeasured(s, catalog).map((r) => [r.id, r.reason, r.reasonText])).toEqual([
      ["B-P0", "timeout", "the site took too long to answer"],
      ["A-P1", "owner_opt_out", "the owner turned off active checks"],
    ]);
  });
});

describe("reasonText", () => {
  it("has plain words for every reason", () => {
    const reasons = [
      "timeout",
      "deadline",
      "rate_limited",
      "owner_opt_out",
      "out_of_scope",
      "not_available",
      "opt_in_required",
    ] as const;
    for (const reason of reasons) {
      const text = reasonText({ outcome: "not_tested", reason });
      expect(text.length, reason).toBeGreaterThan(0);
      expect(text, reason).not.toMatch(/_/);
    }
    expect(reasonText({ outcome: "not_tested", reason: "timeout" })).toBe("the site took too long to answer");
    expect(reasonText({ outcome: "blocked", reason: "owner_opt_out" })).toBe("the owner turned off active checks");
  });

  it("falls back to the outcome when there is no reason", () => {
    expect(reasonText({ outcome: "blocked", reason: null })).toBe(verdictContent.outcomes.blocked);
    expect(reasonText({ outcome: "not_tested", reason: null })).toBe(verdictContent.outcomes.not_tested);
  });

  it("falls back to the outcome for a reason it does not know, including inherited names", () => {
    for (const reason of ["something_new", "toString", "constructor", "__proto__"]) {
      const unknown = { outcome: "not_tested", reason } as unknown as Row;
      expect(reasonText(unknown), reason).toBe(verdictContent.outcomes.not_tested);
    }
  });
});

describe("headline", () => {
  it("says Not set up", () => {
    expect(headline(summary("not_set_up", []), catalog)).toEqual({
      verdict: "not_set_up",
      kind: "not_set_up",
      text: "Not set up",
      unmeasured: [],
    });
  });

  it("says Couldn't reach it", () => {
    expect(headline(summary("unreachable", []), catalog)).toEqual({
      verdict: "unreachable",
      kind: "unreachable",
      text: "Couldn't reach it",
      unmeasured: [],
    });
  });

  it("says Set up, with problems, and leaves the unmeasured list to the working case", () => {
    const s = summary("problems", [row("B-P0", "fail"), row("A-P1", "not_tested", { reason: "timeout" })]);
    expect(headline(s, catalog)).toEqual({
      verdict: "problems",
      kind: "problems",
      text: "Set up, with problems",
      unmeasured: [],
    });
  });

  it("says Working only when every implemented P0 and P1 row was measured", () => {
    const s = summary("working", [
      row("A-P1", "pass"),
      row("B-P0", "pass"),
      row("D-P1", "na"),
      row("F-P0", "pass"),
      // None of these keep it from Working: P2, advisory, and planned rows.
      row("C-P2", "not_tested", { reason: "timeout" }),
      row("E-ADV", "blocked"),
      row("G-P0-PLANNED", "not_tested", { reason: "opt_in_required" }),
    ]);
    expect(headline(s, catalog)).toEqual({
      verdict: "working",
      kind: "working",
      text: "Working (Tier 0 and 1 pass)",
      unmeasured: [],
    });
  });

  it("says No problems found, with what could not be measured and why, when a P0 or P1 row was not measured", () => {
    const s = summary("working", [
      row("A-P1", "blocked", { reason: "owner_opt_out" }),
      row("B-P0", "pass"),
      row("F-P0", "not_tested", { reason: "timeout" }),
    ]);
    const result = headline(s, catalog);
    expect(result.verdict).toBe("working");
    expect(result.kind).toBe("no_problems_found");
    expect(result.text).toBe("No problems found");
    expect(result.unmeasured.map((r) => [r.id, r.title, r.reasonText])).toEqual([
      ["F-P0", "Title of F-P0", "the site took too long to answer"],
      ["A-P1", "Title of A-P1", "the owner turned off active checks"],
    ]);
  });

  it("gives a neutral line for a verdict it does not know, rather than guessing or throwing", () => {
    const s = { ...summary("working", [row("B-P0", "not_tested", { reason: "timeout" })]), verdict: "maybe" } as unknown as Summary;
    expect(headline(s, catalog)).toEqual({
      verdict: null,
      kind: "unknown",
      text: "Result not available",
      unmeasured: [],
    });
  });

  it("says No problems found for a working site with an unmeasured row the catalog does not know", () => {
    const s = summary("working", [row("B-P0", "pass"), row("Q-NEW", "not_tested", { severity: "P1", tier: 1, level: "1" })]);
    const result = headline(s, catalog);
    expect(result.kind).toBe("no_problems_found");
    expect(result.unmeasured.map((r) => [r.id, r.reasonText])).toEqual([["Q-NEW", "this check did not run"]]);
  });
});

describe("the captured summaries in fixtures/", () => {
  const load = (name: string) =>
    JSON.parse(readFileSync(join(__dirname, "..", "fixtures", `summary-${name}.json`), "utf8")) as Summary;
  const view = (name: string) => {
    const s = load(name);
    const h = headline(s, fixtureCatalog);
    return { kind: h.kind, text: h.text, unmeasured: ids(h.unmeasured), fixFirst: ids(fixFirst(s, fixtureCatalog)) };
  };

  it("reads each verdict the way the page should show it", () => {
    expect(view("demo-receiver")).toEqual({ kind: "working", text: "Working (Tier 0 and 1 pass)", unmeasured: [], fixFirst: [] });
    expect(view("failing-p0")).toEqual({ kind: "problems", text: "Set up, with problems", unmeasured: [], fixFirst: ["T0-11"] });
    expect(view("not-set-up")).toEqual({ kind: "not_set_up", text: "Not set up", unmeasured: [], fixFirst: [] });
    expect(view("unreachable")).toEqual({ kind: "unreachable", text: "Couldn't reach it", unmeasured: [], fixFirst: [] });
    expect(view("owner-opt-out")).toEqual({
      kind: "no_problems_found",
      text: "No problems found",
      unmeasured: ["T1-03", "T1-01"],
      fixFirst: [],
    });
    expect(view("timeout")).toEqual({
      kind: "no_problems_found",
      text: "No problems found",
      unmeasured: ["T0-09", "T0-10", "T0-11", "T0-12", "T1-03", "T1-07", "T1-01", "T1-05"],
      fixFirst: [],
    });
  });

  it("explains why each unmeasured row was not measured", () => {
    const h = headline(load("owner-opt-out"), fixtureCatalog);
    expect(h.unmeasured.map((r) => r.reasonText)).toEqual([
      "the owner turned off active checks",
      "the owner turned off active checks",
    ]);
  });
});

describe("content/verdict.json", () => {
  it("contains no em dashes", () => {
    expect(JSON.stringify(verdictContent)).not.toContain(String.fromCharCode(0x2014));
  });
});
