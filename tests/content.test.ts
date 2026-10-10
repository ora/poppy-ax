import { describe, expect, it } from "vitest";
import { content, independentLabelText } from "@/lib/content";
import { reportErrorHref } from "@/lib/report-error";

describe("content/site.json", () => {
  it("carries the independent label, word for word", () => {
    expect(independentLabelText()).toBe(
      "An independent guide by Ora. PAP is developed by its authors (Meta and Sierra, with Genesys, Instinct, Rocket, Shopify, Stripe and Walmart) at personalagentprotocol.org.",
    );
    expect(content.independentLabel.href).toBe("https://personalagentprotocol.org");
  });

  it("carries the draft line and links the spec", () => {
    expect(content.draft.text).toBe("Based on PAP Draft 0.1 (2026-10-09)");
    expect(content.draft.href).toBe("https://personalagentprotocol.org/docs/spec");
  });

  it("names the three nav items", () => {
    expect(content.nav.items.map((item) => item.label)).toEqual(["Check", "Set it up", "Sites"]);
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
