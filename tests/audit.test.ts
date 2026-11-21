import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrackedLink, type TrackedLinkProps } from "@/components/analytics/tracked-link";
import { NotChecked, PassingLine } from "@/components/audit/result";
import auditJson from "@/content/audit.json";
import {
  auditContent,
  auditMeta,
  buildResultView,
  CHECK_WINDOW_MS,
  checkAgain,
  countText,
  formatAbsolute,
  formatRelative,
  imageCacheControl,
  imageCard,
  resolveAuditParam,
} from "@/lib/audit";
import { verdictContent } from "@/lib/verdict";
import { parseSummary } from "@/lib/ora/guards";
import { fill } from "@/lib/template";
import type { Summary } from "@/lib/ora/types";
import { fixtureCatalog } from "@/lib/rows";

function summary(name: string): Summary {
  const parsed = parseSummary(JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8")));
  if (!parsed) throw new Error(`fixtures/${name} does not parse`);
  return parsed;
}

const failing = summary("summary-failing-p0.json");
const timeout = summary("summary-timeout.json");
const unreachable = summary("summary-unreachable.json");
const optOut = summary("summary-owner-opt-out.json");
const receiver = summary("summary-demo-receiver.json");
const notSetUp = summary("summary-not-set-up.json");

/**
 * Verdict `not_checked` (Ruling R70): Ora's own discovery check errored. No
 * capture exists yet, so it is built here from the unreachable fixture: the
 * Tier 0 and Tier 1 rows carry reason `check_error` instead of `timeout`.
 */
const notChecked: Summary = (() => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "summary-unreachable.json"), "utf8"));
  const rows = (raw.rows as Array<Record<string, unknown>>).map((row) =>
    row.reason === "timeout" ? { ...row, reason: "check_error", note: null } : row,
  );
  const parsed = parseSummary({
    ...raw,
    domain: "not-checked.example.com",
    report_url: "https://ora.ai/pap/not-checked.example.com",
    verdict: "not_checked",
    rows,
  });
  if (!parsed) throw new Error("the not_checked summary does not parse");
  return parsed;
})();

/**
 * A Working summary. No capture reads Working with every check measured under
 * 1.0 grading: the demo receiver stops at T0-07, and the opt-out capture
 * leaves six Tier 1 rows unmeasured because the owner turned active checks
 * off. This is the opt-out capture with those six rows read as passing, as a
 * run with active checks on would grade a site that answers them, counts kept
 * in step. Their notes, which say the row was not probed, go with the reason.
 */
const working: Summary = (() => {
  const copy = structuredClone(optOut);
  copy.domain = "working.example.com";
  copy.report_url = "https://ora.ai/pap/working.example.com";
  for (const row of copy.rows) {
    if (row.reason !== "owner_opt_out") continue;
    row.outcome = "pass";
    row.reason = null;
    row.note = null;
    copy.counts.tier1.not_tested -= 1;
    copy.counts.tier1.pass += 1;
  }
  return copy;
})();

/** A time well past every fixture's 6 hour window. */
const LATER = Date.parse("2026-12-12T12:00:00Z");

describe("resolveAuditParam", () => {
  it("renders a canonical domain as it is", () => {
    expect(resolveAuditParam("example.com")).toEqual({ kind: "ok", domain: "example.com" });
    expect(resolveAuditParam("poppy-receiver.roundtrip.workers.dev")).toEqual({
      kind: "ok",
      domain: "poppy-receiver.roundtrip.workers.dev",
    });
  });

  it.each([
    ["WWW.Example.com", "example.com"],
    ["www.example.com", "example.com"],
    ["example.com.", "example.com"],
    ["b%C3%BCcher.de", "xn--bcher-kva.de"],
    ["bücher.de", "xn--bcher-kva.de"],
  ])("sends %s to its canonical spelling %s", (raw, domain) => {
    expect(resolveAuditParam(raw)).toEqual({ kind: "redirect", domain });
  });

  it.each(["not_a_domain", "127.0.0.1", "localhost", "example.com%3A8443", "%E0%A4%A"])("refuses %s", (raw) => {
    const result = resolveAuditParam(raw);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("buildResultView with the six fixtures", () => {
  it("failing P0: the problem verdict, the T0-11 row to fix, no passing line", () => {
    const view = buildResultView(failing, fixtureCatalog, LATER);
    expect(view.headline.text).toBe("Partly ready");
    expect(view.fixFirst.map((row) => row.id)).toEqual(["T0-11"]);
    const [row] = view.fixFirst;
    expect(row?.setupStep).toMatch(/^\/setup#/);
    expect(row?.specUrl).toMatch(/^https:\/\/personalagentprotocol\.org\/docs\/1\.0\/spec/);
    expect(row?.note).toMatch(/^protected_resources does not include https:\/\/failing-p0\.example\.com /);
    expect(row?.whatFailed.length).toBeGreaterThan(0);
    expect(view.passingLine).toBe(false);
    expect(view.invitation).toBe(false);
    expect(view.unmeasured).toEqual([]);
    expect(view.tiers.map((tier) => tier.text)).toEqual(["24 passed, 2 failed, 14 didn't apply", "10 not measured"]);
    expect(view.profile).toBe("pap-1.0@2026-11-21");
    expect(view.reportUrl).toBe("https://ora.ai/pap/failing-p0.example.com");
  });

  it("working with only lower priority failures says so, never a bare 'Nothing'", () => {
    // The opt-out capture reads working, and its one failure (T0-34) is a P2.
    const view = buildResultView(optOut, fixtureCatalog, LATER);
    expect(view.headline.verdict).toBe("working");
    expect(view.fixFirst).toEqual([]);
    expect(view.fixFirstEmpty).toBe(auditContent.fixFirst.noneMinorOne);

    // The same capture with one more of its passing P2 and advisory rows failed, counts kept in step.
    const minor = structuredClone(optOut);
    for (const row of minor.rows) if (row.id === "T0-SIB") row.outcome = "fail";
    minor.counts.tier0.pass -= 1;
    minor.counts.tier0.fail += 1;
    expect(buildResultView(minor, fixtureCatalog, LATER).fixFirstEmpty).toBe(
      fill(auditContent.fixFirst.noneMinorMany, { n: 2 }),
    );
    // The timeout capture reads working with no failure at all.
    expect(buildResultView(timeout, fixtureCatalog, LATER).fixFirstEmpty).toBe(auditContent.fixFirst.none);
  });

  it("timeout: 'No problems found' lists the unmeasured P0 and P1 rows with their reason (R31)", () => {
    const view = buildResultView(timeout, fixtureCatalog, LATER);
    expect(view.headline.kind).toBe("no_problems_found");
    expect(view.headline.text).toBe("Ready");
    expect(view.passingLine).toBe(false);
    expect(view.fixFirst).toEqual([]);
    expect(view.unmeasured.map((row) => row.id)).toEqual(expect.arrayContaining(["T0-09", "T0-10", "T0-11", "T0-12"]));
    const t009 = view.unmeasured.find((row) => row.id === "T0-09");
    expect(t009?.reasonText).toBe(auditJsonReason("timeout"));
    expect(t009?.note).toContain("timed out twice");
    // P2 and advisory rows never count as unmeasured.
    expect(view.unmeasured.every((row) => row.severity === "P0" || row.severity === "P1")).toBe(true);
  });

  it("owner opt-out: the six unprobed rows carry the opt-out reason", () => {
    const view = buildResultView(optOut, fixtureCatalog, LATER);
    expect(view.headline.kind).toBe("no_problems_found");
    expect(view.unmeasured.map((row) => row.id).sort()).toEqual(["T1-01", "T1-03", "T1-05", "T1-07", "T1-15", "T1-16"]);
    expect(view.unmeasured.every((row) => row.reasonText === auditJsonReason("owner_opt_out"))).toBe(true);
  });

  it("unreachable: says so honestly and points at the file, with nothing to fix", () => {
    const view = buildResultView(unreachable, fixtureCatalog, LATER);
    expect(view.headline.text).toBe("Couldn't check");
    expect(view.explain).toBe(auditContent.verdict.explain.unreachable);
    expect(view.fixFirst).toEqual([]);
    expect(view.fixFirstEmpty).toContain("unreachable.example.com/.well-known/poppy.json");
    expect(view.passingLine).toBe(false);
    expect(view.unmeasured).toEqual([]);
  });

  it("not checked: Ora couldn't check it, with no verdict, nothing blamed on the site, and a way to check again", () => {
    const view = buildResultView(notChecked, fixtureCatalog, LATER);
    expect(view.headline.kind).toBe("not_checked");
    expect(view.headline.text).toBe("Couldn't check");
    expect(view.isVerdict).toBe(false);
    expect(view.explain).toBe(auditContent.verdict.explain.not_checked);
    expect(view.explain).toContain("Ora's own check failed");
    expect(view.explain).toContain("not the site's");
    expect(view.fixFirst).toEqual([]);
    expect(view.fixFirstEmpty).toBe(auditContent.fixFirst.notChecked);
    expect(view.invitation).toBe(false);
    // No Ora audit line, and the full report link stays.
    expect(view.passingLine).toBe(false);
    expect(view.reportUrl).toBe("https://ora.ai/pap/not-checked.example.com");
    expect(view.checkAgain).toEqual({ available: true, availableAt: null });
    // Open at once, even inside Ora's 6 hour window: Ora does not serve this result from its cache.
    const soon = Date.parse(notChecked.last_run) + 60_000;
    expect(buildResultView(notChecked, fixtureCatalog, soon).checkAgain).toEqual({ available: true, availableAt: null });
    expect(view.tiers.map((tier) => tier.text)).toEqual(["30 not measured", "7 not measured"]);
  });

  it("not checked: none of its words blame the site", () => {
    const words = [
      verdictContent.headlines.not_checked,
      auditContent.verdict.explain.not_checked,
      auditContent.metadata.descriptions.not_checked,
      auditContent.fixFirst.notChecked,
      auditContent.image.notChecked,
    ].join(" ");
    expect(words).not.toMatch(/reach|down|slow|answer|timed out|fail(ed)? on the site|the site's problem/i);
    expect(words).toMatch(/Ora/);
  });

  it("only the not_checked headline drops the verdict styling", () => {
    for (const fixture of [failing, timeout, unreachable, optOut, receiver, notSetUp]) {
      expect(buildResultView(fixture, fixtureCatalog, LATER).isVerdict, fixture.domain).toBe(true);
    }
  });

  it("demo receiver: partly ready, with the version row first among the rows to fix", () => {
    const view = buildResultView(receiver, fixtureCatalog, LATER);
    expect(view.headline.text).toBe("Partly ready");
    expect(view.fixFirst.map((row) => row.id)).toEqual(["T0-04", "T0-07"]);
    expect(view.passingLine).toBe(false);
    expect(view.unmeasured).toEqual([]);
    expect(view.tiers.map((tier) => tier.text)).toEqual(["7 passed, 2 failed, 31 didn't apply", "10 not measured"]);
  });

  it("'Working' gets the one passing line and nothing else", () => {
    const view = buildResultView(working, fixtureCatalog, LATER);
    expect(view.headline.kind).toBe("working");
    expect(view.headline.text).toBe("Ready");
    expect(view.passingLine).toBe(true);
    expect(view.fixFirst).toEqual([]);
    expect(view.unmeasured).toEqual([]);
    expect(view.tiers.map((tier) => tier.text)).toEqual(["25 passed, 1 failed, 14 didn't apply", "6 passed, 4 didn't apply"]);
  });

  it("not set up: an invitation into /setup, not a failure", () => {
    const view = buildResultView(notSetUp, fixtureCatalog, LATER);
    expect(view.headline.text).toBe("Not yet");
    expect(view.headline.state).toBe("not_yet");
    expect(view.invitation).toBe(true);
    // Not a failure: the line under it says this is the normal case.
    expect(view.explain).toContain("That's normal");
    expect(view.passingLine).toBe(false);
  });

  it("only 'Working' ever gets the passing line", () => {
    const all = { failing, timeout, unreachable, optOut, receiver, notSetUp, notChecked, working };
    const passing = Object.entries(all).filter(([, fixture]) => buildResultView(fixture, fixtureCatalog, LATER).passingLine);
    expect(passing.map(([name]) => name)).toEqual(["working"]);
  });

  it("links to Ora only where the page is allowed to", () => {
    // The page's Ora links: the report (from the summary) and the one line
    // after "Working" to the domain's agent-readiness audit (R63).
    expect(fill(auditContent.passing.href, { domain: receiver.domain })).toBe(
      "https://ora.ai/score/poppy-receiver.roundtrip.workers.dev",
    );
    const text = JSON.stringify(auditJson);
    const oraLinks = text.match(/https:\/\/[a-z.]*ora\.ai[^"]*/g) ?? [];
    expect(oraLinks.sort()).toEqual(["https://ora.ai/score/{domain}"]);
  });
});

describe("the passing line", () => {
  const view = buildResultView(working, fixtureCatalog, LATER);

  it("renders after Working, linking to the domain's agent-readiness audit", () => {
    const html = renderToStaticMarkup(createElement(PassingLine, { view }));
    expect(html).toBe(
      '<p class="audit__passing">Agents can sign in. ' +
        '<a href="https://ora.ai/score/working.example.com">' +
        auditContent.passing.linkText +
        "</a></p>",
    );
  });

  it("records ora_audit_clicked with the domain on its link", () => {
    const line = PassingLine({ view }) as ReactElement<{ children: ReactNode }>;
    const link = Children.toArray(line.props.children).find(
      (child): child is ReactElement<TrackedLinkProps> => isValidElement(child) && child.type === TrackedLink,
    );
    expect(link?.props.href).toBe("https://ora.ai/score/working.example.com");
    expect(link?.props.event).toBe("ora_audit_clicked");
    expect(link?.props.eventProps).toEqual({ domain: "working.example.com" });
  });

  it("renders nothing for a result that is not Working", () => {
    for (const fixture of [failing, timeout, unreachable, optOut, receiver, notSetUp, notChecked]) {
      const html = renderToStaticMarkup(
        createElement(PassingLine, { view: buildResultView(fixture, fixtureCatalog, LATER) }),
      );
      expect(html, fixture.domain).toBe("");
    }
  });
});

function auditJsonReason(reason: "timeout" | "owner_opt_out"): string {
  // The reason words live in content/verdict.json, used through lib/verdict.ts.
  return JSON.parse(readFileSync(join(process.cwd(), "content", "verdict.json"), "utf8")).reasons[reason] as string;
}

describe("What wasn't checked?", () => {
  const render = (fixture: Summary) =>
    renderToStaticMarkup(createElement(NotChecked, { view: buildResultView(fixture, fixtureCatalog, LATER) }));

  it("renders nothing when it has nothing to list", () => {
    for (const fixture of [failing, receiver, unreachable, notSetUp, working]) {
      expect(buildResultView(fixture, fixtureCatalog, LATER).unmeasured, fixture.domain).toEqual([]);
      expect(render(fixture), fixture.domain).toBe("");
    }
  });

  it("lists the must-fix and should-fix checks this run could not measure", () => {
    const html = render(timeout);
    expect(html).toContain('id="not-checked"');
    expect(html).toContain('class="unmeasured"');
    expect(html).toContain(auditContent.notChecked.unmeasured.intro);
    expect(html).not.toContain('class="unchecked"');
  });

  it("no longer describes planned checks or an older draft", () => {
    const words = JSON.stringify(auditContent.notChecked);
    expect(words).not.toMatch(/Draft 0\.\d/);
    expect(words).not.toMatch(/\b[Pp]lanned\b/);
  });
});

describe("checkAgain", () => {
  const lastRun = "2026-10-10T23:13:29.316Z";
  const at = Date.parse(lastRun);

  it("is closed inside Ora's 6 hour window and says when it opens", () => {
    const state = checkAgain(lastRun, at + 60_000);
    expect(state.available).toBe(false);
    expect(state.availableAt?.iso).toBe(new Date(at + CHECK_WINDOW_MS).toISOString());
    expect(state.availableAt?.absolute).toBe("11 Oct 2026, 05:13 UTC");
    expect(state.availableAt?.relative).toBe("in 5 hours");
  });

  it("opens exactly when the window ends", () => {
    expect(checkAgain(lastRun, at + CHECK_WINDOW_MS - 1).available).toBe(false);
    expect(checkAgain(lastRun, at + CHECK_WINDOW_MS)).toEqual({ available: true, availableAt: null });
  });

  it("stays open for a time it cannot read", () => {
    expect(checkAgain("not a time", at)).toEqual({ available: true, availableAt: null });
  });
});

describe("times", () => {
  const now = Date.parse("2026-10-11T02:00:00Z");

  it("formats the absolute time in UTC", () => {
    expect(formatAbsolute("2026-10-10T23:13:29.316Z")).toBe("10 Oct 2026, 23:13 UTC");
  });

  it.each([
    ["2026-10-11T01:59:30Z", "just now"],
    ["2026-10-11T01:55:00Z", "5 minutes ago"],
    ["2026-10-10T23:13:29Z", "2 hours ago"],
    ["2026-10-10T01:00:00Z", "yesterday"],
    ["2026-10-01T00:00:00Z", "last week"],
    ["2026-10-11T05:00:00Z", "in 3 hours"],
  ])("says %s is %s", (iso, text) => {
    expect(formatRelative(iso, now)).toBe(text);
  });
});

describe("countText", () => {
  it("leaves zeros out and folds blocked into not measured", () => {
    expect(countText({ pass: 0, fail: 0, na: 0, blocked: 1, not_tested: 2 })).toBe("3 not measured");
    expect(countText({ pass: 0, fail: 0, na: 0, blocked: 0, not_tested: 0 })).toBe("none");
  });
});

describe("auditMeta", () => {
  it("titles a result with its domain and headline, indexable", () => {
    expect(auditMeta(failing.domain, { kind: "ok", summary: failing }, fixtureCatalog)).toEqual({
      title: "failing-p0.example.com: partly ready for Poppy",
      description: expect.stringContaining("failing-p0.example.com"),
      noindex: false,
    });
    expect(auditMeta(timeout.domain, { kind: "ok", summary: timeout }, fixtureCatalog).title).toBe(
      "timeout.example.com: ready for Poppy",
    );
  });

  it("keeps a not_checked result out of search, and never blames the site in its description", () => {
    const meta = auditMeta(notChecked.domain, { kind: "ok", summary: notChecked }, fixtureCatalog);
    expect(meta).toEqual({
      title: "not-checked.example.com: couldn't check",
      description: "Ora's own check failed when it looked at not-checked.example.com, so there is no result yet.",
      noindex: true,
    });
  });

  it("keeps no-result pages out of search", () => {
    expect(auditMeta("new.example", { kind: "not_scanned" }, fixtureCatalog)).toMatchObject({
      title: "Check new.example",
      noindex: true,
    });
    expect(auditMeta("x.example", { kind: "error", code: "busy", status: 429 }, fixtureCatalog).noindex).toBe(true);
    expect(auditMeta("", { kind: "invalid", code: "invalid_domain" }, fixtureCatalog).noindex).toBe(true);
  });
});

describe("imageCard", () => {
  it("shows the domain, headline, counts and profile, with the accent of the verdict", () => {
    const card = imageCard({ kind: "ok", domain: failing.domain }, { kind: "ok", summary: failing }, fixtureCatalog);
    expect(card).toEqual({
      kind: "result",
      domain: "failing-p0.example.com",
      headline: "Partly ready",
      accent: "poppy",
      tiers: [
        { label: "Public file", text: "24 passed, 2 failed, 14 didn't apply" },
        { label: "Safety checks", text: "10 not measured" },
      ],
      profile: "pap-1.0@2026-11-21",
    });
    const ready = imageCard({ kind: "ok", domain: timeout.domain }, { kind: "ok", summary: timeout }, fixtureCatalog);
    expect(ready.kind === "result" && ready.accent).toBe("ink");
    const notSet = imageCard({ kind: "ok", domain: notSetUp.domain }, { kind: "ok", summary: notSetUp }, fixtureCatalog);
    expect(notSet.kind === "result" && notSet.accent).toBe("muted");
  });

  it("draws a neutral card for not_checked: no verdict accent, no counts", () => {
    expect(
      imageCard({ kind: "ok", domain: notChecked.domain }, { kind: "ok", summary: notChecked }, fixtureCatalog),
    ).toEqual({ kind: "neutral", title: "Ora couldn't check not-checked.example.com" });
  });

  it("asks to check a domain with no result, and stays neutral otherwise", () => {
    expect(imageCard({ kind: "ok", domain: "new.example" }, { kind: "not_scanned" }, fixtureCatalog)).toMatchObject({
      kind: "check",
      title: "Check new.example",
    });
    expect(
      imageCard({ kind: "invalid", error: "invalid", message: "x" }, null, fixtureCatalog).kind,
    ).toBe("neutral");
  });
});

describe("imageCacheControl", () => {
  it("shares a result's image for as long as the summary, with no stale copies", () => {
    expect(imageCacheControl({ kind: "ok", summary: failing })).toBe("public, max-age=60, s-maxage=60");
    expect(imageCacheControl({ kind: "ok", summary: notSetUp })).not.toContain("stale-while-revalidate");
  });

  it("keeps the check, error and invalid cards in the browser only", () => {
    expect(imageCacheControl({ kind: "not_scanned" })).toBe("private, max-age=60");
    expect(imageCacheControl({ kind: "invalid", code: "invalid_domain" })).toBe("private, max-age=60");
    expect(imageCacheControl({ kind: "error", code: "busy", status: 429 })).toBe("private, max-age=60");
    expect(imageCacheControl(null)).toBe("private, max-age=60");
  });
});
