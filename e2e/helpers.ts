import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Fetch a result's preview image and check it is a 1200 x 630 PNG. */
export async function expectPreviewImage(request: APIRequestContext, domain: string): Promise<void> {
  const response = await request.get(`/audit/${domain}/opengraph-image`);
  expect(response.status(), domain).toBe(200);
  expect(response.headers()["content-type"], domain).toBe("image/png");
  expect(pngSize(await response.body()), domain).toEqual({ width: 1200, height: 630 });
}

/** The result page's one line answer, inside the page heading. */
export function verdictOf(page: Page) {
  return page.locator("h1 .audit__verdict");
}

/**
 * Records what the check's status line and progress bar showed, from the
 * first render on, so a test can tell that progress appeared even when the
 * recorded frames replay too fast to catch in between.
 */
export async function recordCheckProgress(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { statuses: [] as string[], progressBar: false };
    (window as unknown as { __checkSeen: typeof seen }).__checkSeen = seen;
    const look = () => {
      if (document.querySelector(".check progress")) seen.progressBar = true;
      const text = document.querySelector(".check__status")?.textContent?.trim();
      if (text && seen.statuses.at(-1) !== text) seen.statuses.push(text);
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

export async function checkProgressSeen(page: Page): Promise<{ statuses: string[]; progressBar: boolean }> {
  return page.evaluate(() => (window as unknown as { __checkSeen: { statuses: string[]; progressBar: boolean } }).__checkSeen);
}

/**
 * Give this page its own visitor address, so the per-visitor check limit (10
 * a minute, counted per server) never trips when the suite runs again soon
 * against the same server. Off Vercel the limit reads `x-real-ip` as sent.
 */
export async function asNewVisitor(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({ "x-real-ip": `198.51.${octet()}.${octet()}` });
}
