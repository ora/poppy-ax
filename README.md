# poppy.ax

A plain guide to the Personal Agent Protocol (PAP), with a checker that shows whether a site lets people's AI assistants in safely.

PAP is an open standard for how an AI assistant finds a company's front door, proves who it is, and acts for a person only within what that person approved. poppy.ax explains it in plain words, walks a company through setting it up, and checks any site against the spec.

## Independent

An independent guide by Ora. PAP is developed by its authors (Meta and Sierra, with Genesys, Instinct, Rocket, Shopify, Stripe and Walmart) at [personalagentprotocol.org](https://personalagentprotocol.org).

poppy.ax is not the official PAP site and does not speak for its authors. Every page is based on [PAP Draft 0.1 (2026-10-09)](https://personalagentprotocol.org/docs/spec) and links the section of the spec each claim comes from. If a sentence is wrong, use the "Report an error" link at the foot of the page.

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
| `npm run test:e2e` | End-to-end tests (Playwright) against a production build in fixture mode. The tests arrive with the result page; until then this command reports that no tests were found. |

## Fixture mode

Set `ORA_FIXTURES=1` to serve recorded responses from `fixtures/` instead of calling Ora's API. Tests and previews use it, and it lets you work offline without a service token. With `ORA_FIXTURES=0` the site calls `ORA_BASE_URL` with `ORA_SERVICE_TOKEN`. The token lives only in environment variables; never commit it. [ORA_API.md](ORA_API.md) is the API contract, and [fixtures/README.md](fixtures/README.md) says how each fixture was captured.

In fixture mode, `lib/ora/client.ts` (the only module that talks to Ora) finds a summary by the `domain` inside each `summary-*.json`, so `/audit/example.com` and `/audit/failing-p0.example.com` show recorded results. Any other valid domain reads as not checked yet, and a domain the site refuses gets the matching answer from `fixtures/errors/`. A check replays `scan-in-progress.sse` with the requested domain, then a completion frame, 30 ms apart; set `ORA_FIXTURES_DELAY_MS` to change the gap. Fixture mode is refused in Vercel production (`VERCEL_ENV=production`): every call to Ora then fails and the server logs why.

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

## Licenses

- Code: [MIT](LICENSE).
- Content in [`content/`](content/): [CC BY 4.0](content/LICENSE). The PAP project is welcome to take it over as an official explainer.

See [CONTRIBUTING.md](CONTRIBUTING.md) to fix a sentence.

## Launch checklist

- [ ] Every factual line checked against the spec
- [ ] OraBot page live
- [ ] Draft and domain shown to the PAP authors before launch
- [ ] Offer to hand the explainer and domain over
- [ ] Bump next, @next/mdx and eslint-config-next to 16.3.8 or later (fixes the high-severity advisories in 16.3.6; due on or after 2026-10-14), then re-run `npm audit`.
