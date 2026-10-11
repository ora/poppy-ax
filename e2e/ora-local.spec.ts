import { expect, test } from "@playwright/test";
import { expectPreviewImage, verdictOf } from "./helpers";

// Against a local Ora dev server, not the fixtures. Runs only when
// ORA_E2E_BASE_URL and ORA_E2E_TOKEN are set (see README.md, "End-to-end
// tests against a local Ora"); playwright.config.ts then starts a second
// poppy.ax server that calls that Ora with that token.
//
// The answers are live, so these tests check the shape of each page, not
// recorded counts. The failing P0 case is covered in fixture mode only:
// Ora's seeded failing site lives under a reserved test name that poppy.ax
// refuses to check (see fixtures/README.md).

const enabled = Boolean(process.env.ORA_E2E_BASE_URL?.trim() && process.env.ORA_E2E_TOKEN?.trim());
test.skip(!enabled, "set ORA_E2E_BASE_URL and ORA_E2E_TOKEN to run against a local Ora");

const RECEIVER = "poppy-receiver.roundtrip.workers.dev";

test("home renders and the domain box reaches a live result", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Let your customers' AI assistants in. Safely.");
  await page.getByLabel("Check a company's site").fill("https://www.Example.com/");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page).toHaveURL(/\/audit\/example\.com$/);
  await expect(verdictOf(page)).toHaveText("Not set up");
});

test("example.com: no poppy.json, so an invitation into the setup guide", async ({ page }) => {
  await page.goto("/audit/example.com");
  await expect(verdictOf(page)).toHaveText("Not set up");
  await expect(page.locator(".audit__invitation")).toHaveText(
    "example.com doesn't publish a PAP file yet. Here's what it takes.",
  );
  await expect(page.getByRole("link", { name: "See every check in the full report" })).toHaveAttribute(
    "href",
    /\/pap\/example\.com/,
  );
});

test("the demo receiver: a passing verdict, browser rows not counted as failures", async ({ page }) => {
  await page.goto(`/audit/${RECEIVER}`);
  // "Working" when every P0 and P1 row was measured, else "No problems found" (Ruling R31).
  await expect(verdictOf(page)).toHaveText(/^(Working \(Tier 0 and 1 pass\)|No problems found)$/);
  await expect(page.getByText("pap-0.1@2026-10-09")).toBeVisible();
  // The receiver has no browser endpoint, so T1-07 is N/A: not a failure.
  await expect(page.locator(".fix-list")).toHaveCount(0);
  await expect(page.locator(".fix-list, .unmeasured").getByText("Browser endpoint rejects a junk assertion")).toHaveCount(0);
  await expect(page.getByRole("definition").nth(1)).toContainText("didn't apply");
});

test("a check runs through poppy.ax's route and ends with a saved result", async ({ request }) => {
  // Ora serves its stored result while the 6 hour window is open, or runs a
  // new check after it; either way the route must end with the saved result.
  const response = await request.post("/api/check/example.com", { headers: { accept: "text/event-stream" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/event-stream");
  const body = await response.text();
  expect(body).toContain('"type":"check_saving"');
  expect(body).toMatch(/"type":"check_result","state":"fresh","last_run":"[^"]+"/);
});

test("preview images render from live results", async ({ request }) => {
  await expectPreviewImage(request, "example.com");
  await expectPreviewImage(request, RECEIVER);
});
