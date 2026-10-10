# Ora API for poppy.ax

poppy.ax has no backend of its own. It asks Ora to check a domain and reads the result. This file is the contract: every endpoint poppy.ax uses, what it sends back and how to call it. Real responses for each case are in [`fixtures/`](fixtures/README.md).

Every statement here was checked against responses from Ora on 10 October 2026. Ignore any field or frame type not listed here, and expect new ones to appear.

## Basics

- **Base URL:** `https://ora.ai`. In poppy.ax it comes from `ORA_BASE_URL`.
- **Auth:** `Authorization: Bearer <ORA_SERVICE_TOKEN>`. The token is a partner key that Ora issues with PAP read access. Send it from the server only. It must never reach a browser, a log line or the repo.
- **Fixture mode:** with `ORA_FIXTURES=1`, poppy.ax reads `fixtures/` instead of calling Ora.

| Endpoint | Auth | What it is for |
| --- | --- | --- |
| `GET /api/scan/stream?domain=<host>&activeProbes=1` | token | Start a check (or get the cached one) and follow its progress |
| `GET /api/pap/v1/summary?domain=<host>` | token | The PAP result for one domain |
| `GET /api/pap/v1/sites` | token | Domains where Ora found a `poppy.json` |
| `GET /pap/catalog.json` | none | Every check, with its tier, severity and spec section |

Pages poppy.ax links to (it never calls them):

- `https://ora.ai/pap/<domain>`: the full row-by-row report. Each summary carries it as `report_url`.
- `https://poppy.ora.ai/<domain>`: a short link. It answers `301` to `https://ora.ai/pap/<domain>`, keeping the path as given (`www.` is not stripped), so link the apex.
- `https://ora.ai/pap/managed`: the managed-PAP waitlist. Link only.

## Checking a domain

1. **Validate first.** Turn the visitor's input into a bare, lowercase host with poppy.ax's own parser: no scheme, path, port, IP address or `localhost`. Map `www.example.com` to `example.com`.
2. **Start the stream** from the server: `GET /api/scan/stream?domain=<host>&activeProbes=1` with the token. Never add `force`. Relay progress to the visitor.
3. **Wait for `scan_complete`.** By then the result is saved. Read on until the connection closes.
4. **Fetch the summary:** `GET /api/pap/v1/summary?domain=<host>`, and show it.

If the stream drops, do not start another. The scan carries on and saves its result without a client: in our test a stream cut after 6 frames still produced a summary about 4 seconds later. Poll the summary every 1 to 2 seconds, sending `Cache-Control: no-cache` and bypassing any fetch cache, until it answers `200`, for up to about 30 seconds. While the scan runs, the summary answers `404 not_scanned`.

To show a stored result without starting a scan, call the summary alone. A `404 not_scanned` means it is time to start one.

## `GET /api/scan/stream`

Starts a check of `domain` and streams its progress as server-sent events. This is Ora's general scan: it runs many checks besides PAP, and the stream reports all of them. poppy.ax uses it only to start the check and to show progress, then reads the PAP result from the summary.

### Request

| Param | Value |
| --- | --- |
| `domain` | The bare host. The parameter is `domain`; `url` is not accepted. |
| `activeProbes` | `1`. Asks Ora to run the Tier 1 active probes, subject to the limit below. |

Never send `force` (see [Limits](#limits)).

### Response

`200`, `content-type: text/event-stream`, `cache-control: no-cache`. Each frame is one `data: <json>` line followed by a blank line. There are no `event:` lines, no ids and no heartbeat, so set a read timeout of at least 60 seconds. Branch on `type` and ignore types you do not know.

**A fresh scan** (`fixtures/scan-in-progress.sse` holds the first 131 frames of one):

| `type` | Fields | Meaning |
| --- | --- | --- |
| `kind_detecting` | `timestamp` | The scan started. |
| `kind_detected` | `kind` (`"domain"`), `hint`, `timestamp` | The input was read as a domain. |
| `scan_init` | `layerMaxScores`, `staticOnly`, `timestamp`; the first one also has `checkRoster`, the second `totalChecks` | Sent twice. |
| `discovery_phase` | `step`, `label`, `stepIndex`, `totalSteps`, `timestamp` | A human-readable step, such as "Fetching example.org". `stepIndex` can exceed `totalSteps`. |
| `check_start` | `layerId`, `layerName`, `checkId`, `checkName`, `timestamp` | One check began. |
| `check_complete` | the same, plus `status` (`pass`, `fail`, `warning`, `na`), `score`, `maxScore`, `details` | One check ended. `details` is text about the scanned site: plain text only. |
| `layer_complete` | `layerId`, `layerName`, `timestamp` | A group of checks ended (four per scan). |
| `scan_complete` | `result`, `timestamp` | Done, and saved. `result` is Ora's full general scan; it is not part of this contract, so do not read it. |

Timestamps are Unix milliseconds. In the captured scan of `example.org`, `totalChecks` was 105 but 131 `check_start` and 131 `check_complete` frames arrived, so a progress bar built on `check_complete / totalChecks` must cap at 100%. That scan took about 4 seconds on a local instance; production adds network time.

**A cached result.** If Ora checked the domain in the last 6 hours, it does not scan again. The response carries an `Age` header (seconds) and exactly two frames:

```
data: {"type":"kind_detected","kind":"domain","timestamp":1791676179641}

data: {"type":"scan_complete","result":{...},"timestamp":1791676179641,"servedFromCache":true,"resultAgeSeconds":6}
```

`servedFromCache` and `resultAgeSeconds` appear only on a cached result. The summary's `last_run` gives the same age; show it as "last checked N minutes ago". `www.example.org` was served the cached `example.org` result.

### Errors

| When | Response |
| --- | --- |
| `domain` missing (or `url` sent instead) | `400`, plain text: `Missing domain parameter` |
| `localhost`, an IP address, or not a domain | `400`, plain text: `Invalid domain. Please provide a real domain (e.g. stripe.com)` |
| The domain does not answer | `200` and one frame, `{"type":"error","message":"Domain is not reachable"}`; no `scan_complete`, nothing saved |

An `error` frame ends the scan. Show it as a failure, as plain text. Treat any other non-`200` status as a failure too.

## `GET /api/pap/v1/summary`

The PAP result of the latest stored scan of one domain.

### Request

`domain`: the host. Ora lowercases it, drops a scheme (`https://example.com`) and reads `www.example.com` as `example.com`. Send the bare apex anyway.

### Response `200`

`content-type: application/json`, `cache-control: private, max-age=60`. Abridged from `fixtures/summary-failing-p0.json`:

```json
{
  "domain": "failing-p0.example.com",
  "profile": "pap-0.1@2026-10-09",
  "last_run": "2026-10-10T23:13:29.316Z",
  "verdict": "problems",
  "counts": {
    "tier0":  { "pass": 19, "fail": 1, "na": 10, "blocked": 0, "not_tested": 0 },
    "tier1":  { "pass": 0, "fail": 0, "na": 0, "blocked": 0, "not_tested": 7 },
    "tier2a": { "pass": 0, "fail": 0, "na": 0, "blocked": 0, "not_tested": 10 },
    "tier2b": { "pass": 0, "fail": 0, "na": 0, "blocked": 0, "not_tested": 36 },
    "tier3":  { "pass": 0, "fail": 0, "na": 0, "blocked": 0, "not_tested": 17 }
  },
  "rows": [
    { "id": "T0-11", "tier": 0, "level": "0", "severity": "P0", "outcome": "fail", "reason": null, "note": "the metadata has no poppy_domains" },
    { "id": "T2-M2", "tier": 2, "level": "2b", "severity": "P0", "outcome": "not_tested", "reason": "opt_in_required", "note": null }
  ],
  "probed_at": null,
  "report_url": "https://ora.ai/pap/failing-p0.example.com"
}
```

| Field | Meaning |
| --- | --- |
| `domain` | The domain the result is stored under: the apex. Asking for `www.example.com` returns `"example.com"`. Use this value in poppy.ax URLs (`/audit/www.x` should become `/audit/x`). |
| `profile` | The PAP check profile the run used, such as `pap-0.1@2026-10-09`. Matches the catalog's `profile`. |
| `last_run` | ISO 8601 UTC time of the scan this result comes from. |
| `probed_at` | ISO 8601 UTC time of the active-probe round that the Tier 1 rows show, or `null` if there is none. It can be earlier than `last_run`: a scan inside the probe limit (below) keeps the earlier round's results. In `fixtures/summary-demo-receiver.json`, `probed_at` is 22:32 and `last_run` 22:50. |
| `verdict` | One word for the domain; see [Verdicts](#verdicts). |
| `counts` | Rows per outcome, for each of `tier0`, `tier1`, `tier2a`, `tier2b` and `tier3`. All five outcome keys are always present, zeros included. |
| `rows` | One entry per catalog row, in catalog order, for every row in the profile (100 today). Fields below. |
| `report_url` | `https://ora.ai/pap/<domain>`, the full report. |

Each row:

| Field | Meaning |
| --- | --- |
| `id` | The catalog row id, such as `T0-11`, `X-08`, `ADV-PKCE`. |
| `tier` | `0`, `1`, `2` or `3` (a number). |
| `level` | `"0"`, `"1"`, `"2a"`, `"2b"` or `"3"` (a string). Splits Tier 2 into 2a and 2b. |
| `severity` | `P0`, `P1`, `P2` or `Adv` (advisory). |
| `outcome` | `pass`, `fail`, `na`, `blocked` or `not_tested`; see [Outcomes and reasons](#outcomes-and-reasons). |
| `reason` | Why a row was not measured, or `null`. |
| `note` | A short detail or `null`. **Untrusted:** it can quote the scanned site's own URLs and values. Render it as plain text only, never as HTML or Markdown, and do not turn it into a link. |

The summary gives ids and outcomes only. poppy.ax writes the plain-language explanation of each row, using the catalog's `title` when it has none.

### Errors

Errors have `cache-control: no-store` and a JSON body `{"error": "<code>"}`.

| Status | `error` | When |
| --- | --- | --- |
| `400` | `invalid_domain` | Not a domain, or `domain` missing or empty |
| `400` | `has_path` | A path, such as `example.com/path` |
| `400` | `has_port` | A port, such as `example.com:8443` |
| `400` | `ip_address` | An IP address |
| `400` | `localhost` | `localhost` |
| `401` | `unauthorized` | No token, an unknown token, or a token without PAP read access (all three look the same) |
| `404` | `not_scanned` | No PAP result is stored for the domain: Ora has never scanned it, or its last scan predates the PAP checks. Start a scan. |
| `405` | (empty body) | Any method other than `GET` |

## Verdicts

| `verdict` | Meaning | Fixture |
| --- | --- | --- |
| `not_set_up` | No valid `poppy.json` was found. In the captures (example.com, example.org) every Tier 0 and Tier 1 row is `na`. | `summary-not-set-up.json` (example.com) |
| `unreachable` | `poppy.json` never answered, so nothing could be measured. In the fixture every Tier 0 and Tier 1 row is `not_tested` with reason `timeout`. | `summary-unreachable.json` |
| `problems` | At least one P0 or P1 row failed. | `summary-failing-p0.json` (T0-11, P0) |
| `working` | `poppy.json` is there and no P0 or P1 row failed. | `summary-demo-receiver.json` |

`working` does not mean every row was measured. In `summary-timeout.json` four P0 rows are `not_tested` (timeout) and the verdict is still `working`; in `summary-owner-opt-out.json` two Tier 1 rows were not probed. Show the `not_tested` rows next to the verdict.

## Outcomes and reasons

| `outcome` | Meaning |
| --- | --- |
| `pass` | The check passed. |
| `fail` | The check failed. `severity` says how much it matters. |
| `na` | Does not apply to this site, such as browser rows on a site with no browser endpoint (T1-07 on the demo receiver), or every row on a site with no `poppy.json`. |
| `blocked` | Counted in `counts`; no captured response had one. Treat it as not measured. |
| `not_tested` | Ora did not measure the row. `reason` and `note` say why. |

Reasons seen with `not_tested`:

| `reason` | Where it appears | Meaning |
| --- | --- | --- |
| `timeout` | Tier 0 and Tier 1 | The site did not answer in time (Ora tries twice). In the timeout fixture, T0-09 notes `timed out twice` and the rows that depend on it note `issuer metadata unavailable`. |
| `owner_opt_out` | Tier 1 | The domain's verified owner turned active probes off. |
| `not_available` | Every Tier 2a and Tier 3 row | Ora does not run these checks yet. Show as "coming soon". |
| `opt_in_required` | Every Tier 2b row | These run only for a verified owner who opts in. |
| `null` | Tier 1 | No probe round is stored for the domain. The note reads: "Active probes run only on a scan requested for this domain. No probe result from the last 30 days." |

In every capture, `pass`, `fail` and `na` rows have `reason: null`. Treat any reason not listed here as "not measured", with generic text.

## `GET /api/pap/v1/sites`

Domains where a scan found a parseable `poppy.json`. No verdicts and no pass or fail data.

`200`, `content-type: application/json`, `cache-control: private, max-age=300`:

```json
{
  "sites": [
    {
      "domain": "poppy-receiver.roundtrip.workers.dev",
      "first_seen": "2026-10-10T22:32:42.042Z",
      "last_seen": "2026-10-10T22:50:02.971Z"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `domain` | The stored apex domain. |
| `first_seen` | ISO 8601 UTC time a scan first found its `poppy.json`. |
| `last_seen` | ISO 8601 UTC time of the latest scan that found it. |

The list is not every site that publishes `poppy.json`: Ora lists only domains it has scanned, and leaves out test domains. poppy.ax sends no parameters. Errors: `401 {"error":"unauthorized"}`, as for the summary.

## `GET /pap/catalog.json`

The full check catalog, generated from the rules Ora runs. Public: no token needed. `200`, `content-type: application/json; charset=utf-8`, `cache-control: public, max-age=3600`. poppy.ax ships a copy in `fixtures/catalog.json`.

Top level:

| Field | Meaning |
| --- | --- |
| `profile` | The check profile, such as `pap-0.1@2026-10-09`. |
| `spec_url` | The PAP spec, `https://personalagentprotocol.org/docs/spec`. |
| `generated_from` | `"ora"`. |
| `rows` | Every check, in report order (100 today). |

Each row:

| Field | Meaning |
| --- | --- |
| `id` | The row id the summary uses. |
| `tier`, `level`, `severity` | As in the summary. |
| `title` | A short name for the check, such as "Document exists". |
| `spec_ref` | Where the requirement comes from, such as `§3`, `Ops §2` or `guides`. |
| `spec_url` | A link to that place in the spec. |
| `profile` | The profile this row belongs to. |
| `implemented` | `true` when Ora runs the check today (Tiers 0 and 1, 37 rows). `false` for Tier 2 and Tier 3 (63 rows). |
| `provisional` | `true` for a planned check whose details may still change. Today it is `true` exactly when `implemented` is `false`. |
| `request` | For a check that sends its own request: `{ "method", "target", "condition" }`, such as `GET`, `https://{domain}/.well-known/poppy.json`, "on every scanned domain". `null` otherwise. `target` is a description, not always a URL. |
| `pass_when` | For planned checks, a one-line pass condition. `null` on rows Ora runs today. |
| `replaces` | The id of an older row this one supersedes, such as `T1-04` for `T2-M1`, or `null`. |

## Limits

- **Freshness: 6 hours.** A stream request for a domain checked in the last 6 hours returns the stored result (see [A cached result](#response)) and runs nothing.
- **Active probes: one round per domain per 6 hours.** A scan inside that window keeps the last round's Tier 1 results; `probed_at` tells you when that round ran. No parameter changes this.
- **Never send `force`.** It skips the freshness window and runs a full new scan every time.
- **Rate-limit visitors yourself.** Every request reaches Ora from poppy.ax's server with the same token, so Ora cannot tell visitors apart. poppy.ax must limit checks per visitor IP at its own edge before it calls the stream.

## Caching

| Response | `cache-control` |
| --- | --- |
| Summary `200` | `private, max-age=60` |
| Sites `200` | `private, max-age=300` |
| Catalog | `public, max-age=3600` |
| Stream | `no-cache` (and `Age` on a cached result) |
| Summary and sites errors | `no-store` |

Right after a scan, fetch the summary without any cache. A summary cached for up to 60 seconds, from before the scan or from a poll, would show the old result. Outside that, caching the summary and sites list for their `max-age` is fine.
