import { expect, test } from "@playwright/test";
import { asNewVisitor, checkProgressSeen, recordCheckProgress, verdictOf } from "./helpers";

// Fixture mode: every answer comes from fixtures/ (see fixtures/README.md).

test.describe("home", () => {
  test("renders the promise and the domain box goes to the result page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Let your customers' AI assistants in. Safely.");
    await expect(page.getByText("Based on PAP Draft 0.1 (2026-10-09)").first()).toBeVisible();

    await page.getByLabel("Check a company's site").fill("https://www.Example.com/");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page).toHaveURL(/\/audit\/example\.com$/);
    await expect(verdictOf(page)).toHaveText("Not set up");
  });

  test("the domain box says why it can't check an address", async ({ page }) => {
    await page.goto("/");
    const box = page.getByLabel("Check a company's site");
    await box.fill("localhost");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(".domain-form__message")).not.toBeEmpty();
    await expect(box).toBeFocused();
  });

  test("Check a site focuses the domain box", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Check a site" }).click();
    await expect(page.getByLabel("Check a company's site")).toBeFocused();
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the home form still reaches the result page", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Check a company's site").fill("Example.com");
    await page.getByLabel("Check a company's site").press("Enter");
    await expect(page).toHaveURL(/\/audit\/example\.com$/);
    await expect(verdictOf(page)).toHaveText("Not set up");
  });

  test("a refused address comes back home with its message", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Check a company's site").fill("127.0.0.1");
    await page.getByLabel("Check a company's site").press("Enter");
    await expect(page).toHaveURL(/\/\?error=[a-z_]+#domain-error-/);
    await expect(page.locator(".domain-form__fallback:target")).toBeVisible();
  });
});

test.describe("a check", () => {
  test("of a domain with no result shows progress, then says the result isn't saved", async ({ page }) => {
    await asNewVisitor(page);
    await recordCheckProgress(page);
    const domain = "never-checked.example.net";
    const streamed = page.waitForResponse((response) => response.url().endsWith(`/api/check/${domain}`));
    await page.goto(`/audit/${domain}`);
    await expect(page.locator("h1")).toHaveText(domain);
    await expect(page.getByText("We haven't checked this site yet.")).toBeVisible();

    const response = await streamed;
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"check_start"');
    expect(body).toContain('"type":"check_saving"');
    // Fixture mode has no saved result for this domain, so the check ends without one.
    expect(body).toContain('"type":"check_result","state":"stale"');

    await expect(page.locator(".check__status")).toHaveText(
      "The check finished, but its result isn't saved yet. Try again in a minute.",
    );
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    const seen = await checkProgressSeen(page);
    expect(seen.progressBar).toBe(true);
    expect(seen.statuses.some((text) => text.startsWith(`Starting the check of ${domain}`) || text === `Checking ${domain}.`)).toBe(
      true,
    );
  });

  test("POST from another site is refused", async ({ request }) => {
    const response = await request.post("/api/check/example.com", {
      headers: { origin: "https://attacker.example.net", "sec-fetch-site": "cross-site" },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("GET does not start a check", async ({ request }) => {
    const response = await request.get("/api/check/example.com");
    expect(response.status()).toBe(405);
  });
});

test.describe("result pages", () => {
  test("example.com: not set up, with an invitation into the setup guide", async ({ page }) => {
    await page.goto("/audit/example.com");
    await expect(verdictOf(page)).toHaveText("Not set up");
    const invitation = page.locator(".audit__invitation");
    await expect(invitation).toHaveText("example.com doesn't publish a PAP file yet. Here's what it takes.");
    await expect(page.locator(".audit__passing")).toHaveCount(0);
    await invitation.getByRole("link", { name: "Here's what it takes" }).click();
    await expect(page).toHaveURL(/\/setup$/);
  });

  test("the demo receiver: working, browser rows didn't apply", async ({ page }) => {
    await page.goto("/audit/poppy-receiver.roundtrip.workers.dev");
    await expect(verdictOf(page)).toHaveText("Working (Tier 0 and 1 pass)");
    const facts = page.getByRole("definition");
    await expect(facts.nth(0)).toHaveText("20 passed, 10 didn't apply");
    await expect(facts.nth(1)).toHaveText("4 passed, 3 didn't apply");
    await expect(page.getByText("pap-0.1@2026-10-09")).toBeVisible();
    // T1-07 (the browser endpoint) is N/A: neither a failure nor unmeasured.
    await expect(page.getByText("Browser endpoint rejects a junk assertion")).toHaveCount(0);
    await expect(page.getByText("Nothing. No P0 or P1 check failed.")).toBeVisible();
    // After a passing result, one line only to Ora's audit.
    const passing = page.locator(".audit__passing");
    await expect(passing).toHaveText(
      "Agents can sign in. Whether they finish the job depends on the rest of your site.",
    );
    await expect(passing.getByRole("link")).toHaveAttribute(
      "href",
      "https://ora.ai/score/poppy-receiver.roundtrip.workers.dev",
    );
    await expect(page.getByRole("link", { name: "See every check in the full report" })).toHaveAttribute(
      "href",
      /^https:\/\/ora\.ai\/pap\/poppy-receiver\.roundtrip\.workers\.dev/,
    );
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  });

  test("failing P0: set up, with problems, T0-11 first with its setup step", async ({ page }) => {
    await page.goto("/audit/failing-p0.example.com");
    await expect(verdictOf(page)).toHaveText("Set up, with problems");
    const first = page.locator(".fix-list > li").first();
    await expect(first.locator(".tag")).toHaveText("P0");
    await expect(first.getByRole("heading")).toContainText("Domain binding");
    await expect(first).toContainText("poppy_domains in the issuer's OAuth metadata does not include organization.domain.");
    const fix = first.getByRole("link", { name: "How to fix it" });
    await expect(fix).toHaveAttribute("href", "/setup#level-1-name-your-sign-in-server");
    await fix.click();
    await expect(page).toHaveURL(/\/setup#level-1-name-your-sign-in-server$/);
    await expect(page.locator("#level-1-name-your-sign-in-server")).toBeVisible();
  });

  test("timeout: no problems found, and the unmeasured rows are named", async ({ page }) => {
    await page.goto("/audit/timeout.example.com");
    await expect(verdictOf(page)).toHaveText("No problems found");
    const unmeasured = page.locator(".unmeasured");
    await expect(unmeasured.getByRole("heading", { name: "Not measured on this run" })).toBeVisible();
    await expect(unmeasured.locator(".unmeasured__list > li")).not.toHaveCount(0);
    await expect(unmeasured).toContainText("Domain binding");
    await expect(unmeasured).toContainText("Why: the site took too long to answer.");
    await expect(page.locator(".audit__passing")).toHaveCount(0);
  });

  test("unreachable: couldn't reach it", async ({ page }) => {
    await page.goto("/audit/unreachable.example.com");
    await expect(verdictOf(page)).toHaveText("Couldn't reach it");
    await expect(
      page.getByText("First make sure unreachable.example.com/.well-known/poppy.json answers over HTTPS. Then check again."),
    ).toBeVisible();
  });

  test("owner opt-out: the probes the owner turned off are named", async ({ page }) => {
    await page.goto("/audit/opt-out.example.com");
    await expect(verdictOf(page)).toHaveText("No problems found");
    await expect(page.locator(".unmeasured")).toContainText("Why: the owner turned off active checks.");
  });

  test("what wasn't checked lists Tier 2 and Tier 3 by name", async ({ page }) => {
    await page.goto("/audit/poppy-receiver.roundtrip.workers.dev");
    const groups = page.locator(".unchecked__group summary");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toContainText("Coming soon");
    await expect(groups.nth(1)).toContainText("Requires opt-in");
    await expect(groups.nth(2)).toContainText("Signed-in flows");
  });

  test("an address that isn't a domain gets its reason and the box", async ({ page }) => {
    const response = await page.goto("/audit/localhost");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We can't check that");
    await expect(page.getByLabel("Check a company's site")).toBeVisible();
    await expect(page.locator(".domain-form__message")).not.toBeEmpty();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("a mixed-case www address redirects to its one spelling", async ({ page }) => {
    await page.goto("/audit/WWW.Example.com");
    await expect(page).toHaveURL(/\/audit\/example\.com$/);
  });
});

test.describe("keyboard", () => {
  test("the skip link is the first stop and moves focus to the main content", async ({ page }) => {
    await page.goto("/setup");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("the domain box takes a domain from the keyboard alone", async ({ page }) => {
    await page.goto("/");
    const box = page.getByLabel("Check a company's site");
    while (!(await box.evaluate((element) => element === document.activeElement))) {
      await page.keyboard.press("Tab");
    }
    await page.keyboard.type("example.com");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/audit\/example\.com$/);
  });

  test("a focused link below the fold is scrolled into view", async ({ page }) => {
    await page.goto("/audit/failing-p0.example.com");
    const fix = page.getByRole("link", { name: "How to fix it" }).first();
    for (let stops = 0; stops < 20 && !(await fix.evaluate((element) => element === document.activeElement)); stops += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(fix).toBeFocused();
    await expect(fix).toBeInViewport();
  });

  test("Try again starts a new check from the keyboard", async ({ page }) => {
    await asNewVisitor(page);
    await page.goto("/audit/never-checked.example.net");
    const again = page.getByRole("button", { name: "Try again" });
    await again.focus();
    const rerun = page.waitForResponse((response) => response.url().endsWith("/api/check/never-checked.example.net"));
    await page.keyboard.press("Enter");
    expect((await rerun).status()).toBe(200);
  });
});

test.describe("setup and sites", () => {
  test("/setup has four levels, then the managed box", async ({ page }) => {
    await page.goto("/setup");
    const levels = page.locator("section.level");
    await expect(levels).toHaveCount(4);
    for (const n of [1, 2, 3, 4]) {
      await expect(page.locator(`section.level[data-level="${n}"] h2`)).toBeVisible();
    }
    const box = page.locator(".hosted-note");
    await expect(box).toContainText("Rather not run an issuer yourself?");
    await expect(box.getByRole("link")).toHaveAttribute("href", "https://ora.ai/pap/managed");
    // The box comes after level 4.
    const order = await page.evaluate(() => {
      const last = document.querySelector('section.level[data-level="4"]');
      const note = document.querySelector(".hosted-note");
      return last && note ? last.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy();
  });

  test("/sites lists the recorded site with a link to its result", async ({ page }) => {
    await page.goto("/sites");
    const row = page.locator(".sites__row", { hasText: "poppy-receiver.roundtrip.workers.dev" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link")).toHaveAttribute("href", "/audit/poppy-receiver.roundtrip.workers.dev");
    await expect(page.getByRole("link", { name: "ARC" })).toHaveAttribute("href", "https://www.arcreport.ai/protocols/pap");
  });

  test("every page carries the independent label, the draft line and Report an error", async ({ page }) => {
    for (const path of ["/", "/setup", "/sites", "/audit/example.com"]) {
      await page.goto(path);
      await expect(page.getByText("An independent guide by Ora.").first(), path).toBeVisible();
      await expect(page.getByText("Based on PAP Draft 0.1 (2026-10-09)").first(), path).toBeVisible();
      await expect(page.getByRole("link", { name: /Report an error/ }).first(), path).toBeVisible();
    }
  });
});
