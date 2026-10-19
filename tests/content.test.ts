import { describe, expect, it } from "vitest";
import { content, independentLabelText } from "@/lib/content";
import { reportErrorHref } from "@/lib/report-error";

describe("content/site.json", () => {
  it("carries the independent label, word for word", () => {
    expect(independentLabelText()).toBe(
      "An independent guide by Ora. Poppy is developed by Meta and Sierra with industry partners, at personalagentprotocol.org.",
    );
    expect(content.independentLabel.href).toBe("https://personalagentprotocol.org");
  });

  it("carries the draft line and links the spec", () => {
    expect(content.draft.text).toBe("Based on Poppy Draft 0.2 (in progress, read 2026-10-19)");
    expect(content.draft.href).toBe("https://personalagentprotocol.org/docs/spec");
  });

  it("names the nav items, then the Check a site button", () => {
    expect(content.nav.items).toEqual([
      { label: "What is Poppy?", href: "/learn" },
      { label: "Set it up", href: "/setup" },
    ]);
    expect(content.nav.check).toBe("Check a site");
  });

  it("links Sites from the footer", () => {
    expect(content.footerLinks).toEqual([{ label: "Sites", href: "/sites" }]);
  });

  it("keeps PAP as a search alias in the metadata", () => {
    expect(content.metadata.description).toContain("(also called PAP)");
    expect(content.metadata.keywords).toEqual(expect.arrayContaining(["Poppy", "Personal Agent Protocol", "PAP"]));
  });

  it("has a heading for every placeholder page", () => {
    for (const page of Object.values(content.pages)) {
      expect(page.heading.length).toBeGreaterThan(0);
    }
  });

  it("contains no em dashes", () => {
    expect(JSON.stringify(content)).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("reportErrorHref", () => {
  it("puts the URL-encoded page path in the issue title", () => {
    expect(reportErrorHref(content.reportError.newIssueUrl, "/setup")).toBe(
      "https://github.com/ora/poppy-ax/issues/new?title=%2Fsetup",
    );
    expect(reportErrorHref(content.reportError.newIssueUrl, "/audit/example.com")).toBe(
      "https://github.com/ora/poppy-ax/issues/new?title=%2Faudit%2Fexample.com",
    );
  });
});
