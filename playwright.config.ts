import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. Two kinds:
//
// - Fixture mode (projects "phone" and "desktop"): a production build that
//   serves the recorded answers in fixtures/, so the tests never call Ora.
//   Set PLAYWRIGHT_BASE_URL to run them against a server you started instead.
// - Local Ora (project "ora-local"): the same build, run a second time on its
//   own port with ORA_BASE_URL and ORA_SERVICE_TOKEN pointing at an Ora dev
//   server. It runs only when ORA_E2E_BASE_URL and ORA_E2E_TOKEN are set
//   (see README.md); otherwise its tests are skipped.
const port = 3100;
const oraPort = 3101;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const oraBaseURL = process.env.ORA_E2E_BASE_URL?.trim();
const oraToken = process.env.ORA_E2E_TOKEN?.trim();
const withOra = Boolean(oraBaseURL && oraToken);

const fixtureServer = {
  command: `npm run build && npx next start -p ${port}`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: { ORA_FIXTURES: "1", ORA_FIXTURES_DELAY_MS: "0" },
};

// Started after the fixture server, so it serves the build that one made.
const oraServer = {
  command: `npx next start -p ${oraPort}`,
  url: `http://localhost:${oraPort}`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { ORA_FIXTURES: "0", ORA_BASE_URL: oraBaseURL ?? "", ORA_SERVICE_TOKEN: oraToken ?? "" },
};

const webServer = [
  ...(process.env.PLAYWRIGHT_BASE_URL ? [] : [fixtureServer]),
  ...(withOra ? [oraServer] : []),
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "phone", testIgnore: /ora-local\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "desktop", testIgnore: /ora-local\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "ora-local",
      testMatch: /ora-local\.spec\.ts/,
      // A real check against a dev server is slower than a recorded one.
      timeout: 120_000,
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${oraPort}` },
    },
  ],
  webServer: webServer.length > 0 ? webServer : undefined,
});
