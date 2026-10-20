# poppy.ax

A plain guide to the Personal Agent Protocol (PAP), with a checker that shows whether a site lets people's AI assistants in safely.

PAP is an open standard for how an AI assistant finds a company's front door, proves who it is, and acts for a person only within what that person approved. poppy.ax explains it in plain words, walks a company through setting it up, and checks any site against the spec.

## Independent

An independent guide by Ora. PAP is developed by its authors (Meta and Sierra, with Genesys, Instinct, Rocket, Shopify, Stripe and Walmart) and 35 design partners, at [personalagentprotocol.org](https://personalagentprotocol.org).

poppy.ax is not the official PAP site and does not speak for its authors. Every page is based on [PAP Draft 0.2](https://personalagentprotocol.org/docs/spec), which is still in progress (read 2026-10-19; Draft 0.1 was published 2026-10-09), and links the section of the spec each claim comes from. If a sentence is wrong, use the "Report an error" link at the foot of the page.

## How it works

poppy.ax has no backend of its own and adds no checks. Every result comes from Ora's API (the summary, the scan trigger, the sites list and the check catalog), called from the server only. All page text lives as JSON and MDX in [`content/`](content/), so anyone can fix a sentence with a pull request.

## Run it

You need Node 22 (see `.nvmrc`) and npm.

```sh
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://poppy-ax.localhost:1355
```

`npm run dev` uses [portless](https://port1355.dev) for a stable local URL and installs it globally if it is missing.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no output |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) against a production build in fixture mode, on a phone and a desktop browser. See below for the run against a local Ora. |

## Fixture mode

Set `ORA_FIXTURES=1` to serve recorded responses from `fixtures/` instead of calling Ora's API. Tests and previews use it, and it lets you work offline without a service token. With `ORA_FIXTURES=0` the site calls `ORA_BASE_URL` with `ORA_SERVICE_TOKEN`. The token lives only in environment variables; never commit it. [ORA_API.md](ORA_API.md) is the API contract, and [fixtures/README.md](fixtures/README.md) says how each fixture was captured.

In fixture mode, `lib/ora/client.ts` (the only module that talks to Ora) finds a summary by the `domain` inside each `summary-*.json`, so `/audit/example.com` and `/audit/failing-p0.example.com` show recorded results. Any other valid domain reads as not checked yet, and a domain the site refuses gets the matching answer from `fixtures/errors/`. A check replays `scan-in-progress.sse` with the requested domain, then a completion frame, 30 ms apart; set `ORA_FIXTURES_DELAY_MS` to change the gap. Fixture mode is refused in Vercel production (`VERCEL_ENV=production`): every call to Ora then fails and the server logs why.

## End-to-end tests

`npm run test:e2e` builds the site, starts it on port 3100 with `ORA_FIXTURES=1` and `ORA_FIXTURES_DELAY_MS=0`, and runs `e2e/` in two projects, `phone` (Pixel 7) and `desktop`. They cover the home page and its domain box (with and without JavaScript), a check with its progress, every recorded result (not set up, working, set up with problems, no problems found, couldn't reach it, owner opt-out), an address that can't be checked, /setup, /sites, the keyboard path, the refusal of a check started from another site, and a 1200 x 630 PNG preview image per result. If a server is already running on port 3100 it is reused, so start it in fixture mode.

A third project, `ora-local`, runs the same site against a local Ora instead of the fixtures. It is skipped unless both of these test-only variables are set:

| Variable | Value |
| --- | --- |
| `ORA_E2E_BASE_URL` | The local Ora's address, such as `http://localhost:3000` |
| `ORA_E2E_TOKEN` | A local partner key with PAP read access |

```sh
ORA_E2E_BASE_URL=http://localhost:3000 ORA_E2E_TOKEN=... npx playwright test --project=ora-local
```

It starts a second server on port 3101 with `ORA_FIXTURES=0`, `ORA_BASE_URL` and `ORA_SERVICE_TOKEN` taken from those two, and checks the home page, the results for example.com and the demo receiver, a check through the site's own route, and their preview images. The failing P0 case runs in fixture mode only: Ora keeps its failing test site under a reserved name that poppy.ax refuses to check. Never put these variables in `.env.example` or `.env.local`.

## Performance and accessibility

Lighthouse 13.5.0, mobile emulation (`--form-factor=mobile`, simulated throttling), categories performance and accessibility, against `next build && next start` in fixture mode on 2026-10-11. Median of three runs:

| Page | Performance | Accessibility |
| --- | --- | --- |
| `/` | 98 | 100 |
| `/audit/example.com` | 97 | 100 |
| `/setup` | 97 | 100 |
| `/sites` | 98 | 100 |

```sh
npx lighthouse@13.5.0 http://localhost:3100/ --form-factor=mobile --only-categories=performance,accessibility
```

## What we measure

We use Vercel Web Analytics with seven custom events, to learn whether the guide helps. There is no personal data: no IP address, user agent, email or full URL is ever put in an event. `lib/analytics.ts` is the one place events are sent, and it drops any value that is not in the list below.

| Event | When | Values |
| --- | --- | --- |
| `domain_checked` | A domain is submitted in the box (JavaScript path only; the no-JavaScript redirect is not counted) | `domain` |
| `result_viewed` | A result page is viewed, once per view | `domain`, `verdict`, `referrer_host` |
| `setup_level_viewed` | A level on /setup first scrolls into view, once per level per view | `level` |
| `full_report_clicked` | The link to the full report | `domain` |
| `owner_verification_clicked` | The owner verification link | `domain` |
| `ora_audit_clicked` | The one line after a passing result | `domain` |
| `waitlist_clicked` | The managed PAP box on /setup | none |

`domain` is the normalised company domain. `referrer_host` is the host the visitor came from, never a path or query, and empty for a direct visit. The package sends nothing unless the page is served by Vercel with Web Analytics on.

## Staying on Ora's draft

poppy.ax explains the draft Ora's checks grade, and the recorded catalog (`fixtures/catalog.json`) says which one in its `profile`. `tests/spec-version.test.ts` fails if the draft line, the home page status, the spec line on /learn or this README names a different draft or read date.

Once a week, `.github/workflows/spec-drift-watch.yml` runs `scripts/spec-drift.mjs` (shared with ax.guide and Ora) to compare Ora's live catalog with the pin in `spec-watch.json`. When Ora has moved to a new draft, it opens an issue that lists what to update, and escalates it after 14 days. With an `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` secret, it also starts `.github/workflows/spec-drift-fix.yml`. That workflow records Ora's new catalog, moves the pin and opens a pull request with Claude's review: what changed between the drafts and the edits the guide needs. Claude only writes that review (it reads files, with no shell, web access or GitHub token), so a maintainer makes the edits on the branch; `tests/spec-version.test.ts` fails until they do, and the pull request opens as a draft. Close and reopen it to run CI. A failed run opens its own issue, and so does a copy of `scripts/spec-drift.mjs` that no longer matches ax.guide's.

## Licenses

- Code: [MIT](LICENSE).
- Content in [`content/`](content/): [CC BY 4.0](content/LICENSE). The PAP project is welcome to take it over as an official explainer.

See [CONTRIBUTING.md](CONTRIBUTING.md) to fix a sentence.

## Launch checklist

In order. Each item is done by a person; tick it in a pull request.

Before anyone outside sees it:

- [ ] Every factual line checked against the spec, Draft 0.2 (in progress, read 2026-10-19). Each page's content was reviewed against the spec when it was written; before launch, run the spec anchor check again: every `personalagentprotocol.org` link with a `#section` in `content/`, `app/`, `components/` and `lib/` must land on a heading that exists on the live page. Last run 2026-10-11: 55 of 55 found (29 in the spec, 13 in the guides, 13 in the operations extension).
- [ ] Owner review of the copy, for voice.
- [x] The home page's problem copy: the owner chose it on 2026-10-11. It cites Sierra's announcement, and the claim about passwords is gone.

Ora's side, deployed first:

- [ ] Ora's PAP API is live in production: migrations run, the list of sites backfilled, and the `poppy.ora.ai` domain added.
- [ ] The OraBot page is live at https://ora.ai/bot.
- [ ] The managed PAP page (https://ora.ai/pap/managed) is live with its waitlist form id set, before /setup links to it in production.
- [ ] A partner key with PAP read access issued for poppy.ax.

The Vercel project:

- [ ] `ORA_SERVICE_TOKEN` set to that key (production and preview), and `ORA_BASE_URL` left at `https://ora.ai`. `ORA_FIXTURES` unset in production.
- [ ] `NEXT_PUBLIC_SITE_URL` unset in production (it defaults to https://poppy.ax) and on previews (each uses its own branch address), and Vercel's system environment variables exposed to the build, so `NEXT_PUBLIC_VERCEL_ENV` and `NEXT_PUBLIC_VERCEL_BRANCH_URL` are set.
- [ ] The project is on a plan that allows `maxDuration = 330` for `/api/check/[domain]`, or lower it to 300 in `app/api/check/[domain]/route.ts`.
- [ ] A Vercel Firewall rate-limit rule (60 checks an hour per IP) created in the dashboard, and its id set as `POPPY_CHECK_RATE_LIMIT_ID`. Keep the window at one hour: the "Try again in 60 minutes" message (`FIREWALL_RETRY_SECONDS` in `lib/visitor-limit.ts`) assumes it.
- [ ] Vercel Web Analytics turned on for the project.
- [x] Bump next, @next/mdx and eslint-config-next to 16.3.8 or later (fixes the high-severity advisories in 16.3.6). Done 2026-10-11: `npm audit` reports 0 vulnerabilities and the tests pass.

On a preview deploy, check by hand:

- [ ] After a check, the result page shows the new result at once (the summary's cache entry expires).
- [ ] A result's preview image carries `s-maxage=60`, and a shared cache serves it no longer than that.
- [ ] Ora's catalog is cached for an hour (`/pap/catalog.json` answers with `max-age=3600`) and the result page still renders when it is unavailable.
- [ ] A check keeps running and its result is saved when the visitor closes the tab mid-check.

With the PAP authors:

- [ ] The draft and the domain shown to the PAP authors before launch.
- [ ] Offer to hand the explainer and the domain over, if they want an official one.
