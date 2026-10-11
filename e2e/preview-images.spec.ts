import { expect, test } from "@playwright/test";
import { expectPreviewImage } from "./helpers";

// One recorded result per verdict, plus the cards for a domain with no
// result and for an address that can't be checked.
const DOMAINS = {
  not_set_up: "example.com",
  working: "poppy-receiver.roundtrip.workers.dev",
  problems: "failing-p0.example.com",
  no_problems_found: "timeout.example.com",
  unreachable: "unreachable.example.com",
  owner_opt_out: "opt-out.example.com",
  not_checked_yet: "never-checked.example.net",
  invalid: "localhost",
} as const;

test.describe("preview images", () => {
  for (const [verdict, domain] of Object.entries(DOMAINS)) {
    test(`${verdict}: a 1200 x 630 PNG`, async ({ request }) => {
      await expectPreviewImage(request, domain);
    });
  }

  test("a result's image is cached as long as its summary", async ({ request }) => {
    const response = await request.get(`/audit/${DOMAINS.working}/opengraph-image`);
    expect(response.headers()["cache-control"]).toContain("s-maxage=60");
  });

  test("the result page points its preview at the image", async ({ page }) => {
    await page.goto(`/audit/${DOMAINS.problems}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /\/audit\/failing-p0\.example\.com\/opengraph-image/,
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  });
});
