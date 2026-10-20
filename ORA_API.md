# Ora API for poppy.ax

poppy.ax has no backend of its own. It asks Ora to check a domain and reads the result. This file is the contract: every endpoint poppy.ax uses, what it sends back and how to call it. Real responses for each case are in [`fixtures/`](fixtures/README.md).

We wrote it from responses captured from a local Ora instance on 10 and 11 October 2026, and from the public behaviour of each route. Where a statement rests on one observation, it says so. A few statements come from Ora's change set dated 2026-10-11 and have not been captured from a running Ora yet; each one is marked "from Ora's change set dated 2026-10-11, not yet captured live". Ignore any field or frame type not listed here, and expect new ones to appear.

## Basics

- **Base URL:** `https://ora.ai`. In poppy.ax it comes from `ORA_BASE_URL`.
- **Auth:** `Authorization: Bearer <ORA_SERVICE_TOKEN>`. The token is a partner key that Ora issues with PAP read access (`pap:read`). Send it from the server only. It must never reach a browser, a log line or the repo.
- **Fixture mode:** with `ORA_FIXTURES=1`, poppy.ax reads `fixtures/` instead of calling Ora.
- **Spec label:** the checks follow the PAP draft spec. Ora names the draft on its reports, for example "PAP Draft 0.2 (in progress, read 2026-10-19; may change)". The catalog carries the same facts as `profile` (`pap-0.2@2026-10-19`: the version and the day Ora read it), `spec_version` and `draft`. poppy.ax follows the same draft: see [Staying on Ora's draft](README.md#staying-on-oras-draft).

| Endpoint | Auth | What it is for |
| --- | --- | --- |
| `GET /api/scan/stream?domain=<host>&activeProbes=1` | token (sent, but optional: see [Errors](#errors)) | Start a check (or get the stored one) and follow its progress |
| `GET /api/pap/v1/summary?domain=<host>` | token | The PAP result for one domain |
| `GET /api/pap/v1/sites` | token | Domains that publish a `poppy.json` naming themselves |
| `GET /pap/catalog.json` | none | Every check, with its tier, severity, spec section and pass rule |

**Check the token with the summary, not the stream.** The stream is Ora's public scanner, the same one behind ora.ai's own scan page, so it never answers `401`: a missing or unknown token just makes the caller an anonymous visitor under Ora's per-IP limits. The token only swaps those per-IP limits for the key's own daily budget (see [Limits](#limits)); a call without it never spends that budget. Any summary call with a bad token answers `401`, so a `401` there means poppy.ax is misconfigured.

Pages poppy.ax links to (it never calls them):

- `https://ora.ai/pap/<domain>`: the full row-by-row report. Each summary carries it as `report_url`.
- `https://poppy.ora.ai/<domain>`: a short link. It answers `301` to `https://ora.ai/pap/<domain>`. It removes one leading `www.`, so `poppy.ora.ai/www.example.com` goes to `/pap/example.com`.
- `https://ora.ai/pap/managed`: the managed-PAP waitlist. Link only.
- `https://app.ora.ai/verify?domain=<domain>`: owner verification, for the "requires opt-in" (Tier 2b) checks. The owner signs in and verifies `<domain>` there. poppy.ax fills in the result's `domain` (from Ora's change set dated 2026-10-11, not yet captured live).

## Checking a domain

1. **Validate first.** Turn the visitor's input into a bare, lowercase host with poppy.ax's own parser. Reject a scheme, path, port, IP address or `localhost`. Map `www.example.com` to `example.com`.
2. **Limit the visitor.** Apply poppy.ax's own per-IP limit before calling Ora (see [Limits](#limits)).
3. **Open one stream per domain.** Do not open a second stream for a domain while one is running: Ora would start a second scan.
4. **Start the stream** from the server and note the time you opened it. Call `GET /api/scan/stream?domain=<host>&activeProbes=1` with the token. Never add `force` or `fresh`: Ora refuses either from a PAP read key with `403` (from Ora's change set dated 2026-10-11, not yet captured live). Relay progress to the visitor.
5. **Read until the stream closes.** `scan_complete` is not the end. Ora sends it before it saves the result. When the save succeeds, it finishes before the connection closes.
6. **Fetch the summary** with `GET /api/pap/v1/summary?domain=<host>`. Trust it only if the stream was a cache hit, or if its `last_run` is at or after the stream's start time minus 5 seconds.
7. **Poll if it is not fresh yet.** If the summary is older than that, or answers `404 not_scanned`, poll every 1 to 2 seconds. Send `Cache-Control: no-cache` and bypass any fetch cache. Stop after about 30 seconds.
8. **Fail cleanly after 30 seconds.** If no fresh summary arrived, tell the visitor the check could not finish. Offer the previous result, if there is one, clearly marked with its date.

While a scan runs, the summary does not change. For a domain never checked before it answers `404 not_scanned`. For a domain checked before it answers `200` with the old result, and its `last_run` gives it away. In our test a rescan of example.org started at 00:34:14 UTC. Polls during the scan returned the previous `last_run` (23:49:33 the day before). The first poll after the stream closed returned 00:34:20.

**If the stream drops,** do not open another one. Go straight to step 7. On a local instance, a scan cut off after 6 frames still saved its result, and the summary appeared about 4 seconds later. That was not tested on production, so the 30-second failure path matters.

To show a stored result without starting a scan, call the summary alone. A `404 not_scanned` means it is time to start one.

## `GET /api/scan/stream`

Starts a check of `domain` and streams its progress as server-sent events. This is Ora's general scan: it runs many checks besides PAP, and the stream reports all of them. poppy.ax uses it only to start the check and to show progress. It reads the PAP result from the summary.

### Request

| Param | Value |
| --- | --- |
| `domain` | The bare host. The parameter is `domain`; `url` is not accepted. |
| `activeProbes` | `1`. Asks Ora to run the Tier 1 active probes, within the limit below. |

Never send `force` or `fresh`. Both skip the stored result and run a full new scan (see [Limits](#limits)). A PAP read key that sends either gets `403` `{"error": "force_not_allowed"}` (from Ora's change set dated 2026-10-11, not yet captured live).

### Response

`200`, `content-type: text/event-stream`, `cache-control: no-cache`. Each frame is one `data: <json>` line followed by a blank line. There are no `event:` lines, no ids and no heartbeat. Allow at least 60 seconds between frames, and give up on the whole stream after 5 minutes, which is the longest Ora keeps one open. Branch on `type` and ignore types you do not know.

**A fresh scan** (`fixtures/scan-in-progress.sse` holds the first 131 frames of one):

| `type` | Fields | Meaning |
| --- | --- | --- |
| `kind_detecting` | `timestamp` | The scan started. |
| `kind_detected` | `kind` (`"domain"`), `hint`, `timestamp` | The input was read as a domain. |
| `scan_init` | `layerMaxScores`, `staticOnly`, `timestamp`; the first one also has `checkRoster`, the second `totalChecks` | Sent twice. |
| `discovery_phase` | `step`, `label`, `stepIndex`, `totalSteps`, `timestamp` | A human-readable step, such as "Fetching example.org". `stepIndex` can exceed `totalSteps`. |
| `check_start` | `layerId`, `layerName`, `checkId`, `checkName`, `mcpKind`, `mcpUrl`, `timestamp` | One check began. |
| `check_complete` | the same, plus `status` (`pass`, `fail`, `warning`, `na`, `error`, `pending`), `score`, `maxScore`, `details` | One check ended. `details` is text about the scanned site: plain text only. |
| `layer_complete` | `layerId`, `layerName`, `timestamp` | A group of checks ended. A scan has four. |
| `scan_complete` | `result`, `timestamp` | The checks are done. The result is not saved yet: read on until the connection closes. `result` is Ora's full general scan and not part of this contract, so do not read it. |
| `error` | `message` | The scan stopped. See [Errors](#errors). |

Timestamps are Unix milliseconds. In the captured scan of `example.org`, `totalChecks` was 105 but 131 `check_start` and 131 `check_complete` frames arrived. A progress bar built on `check_complete / totalChecks` must therefore cap at 100%. That scan took about 4 to 6 seconds on a local instance; production adds network time.

**A stored result.** If Ora checked the domain in the last 6 hours, it normally returns the stored result and does not scan again. A stored scan whose analysis is still finishing does not count, so that request starts a new scan. A stored result comes with an `Age` header (seconds) and exactly two frames:

```
data: {"type":"kind_detected","kind":"domain","timestamp":1791676179641}

data: {"type":"scan_complete","result":{...},"timestamp":1791676179641,"servedFromCache":true,"resultAgeSeconds":6}
```

`servedFromCache` and `resultAgeSeconds` appear only on a stored result. The summary's `last_run` gives the same age; show it as "last checked N minutes ago". `www.example.org` was served the stored `example.org` result.

### Errors

The stream never answers `401`. With no token, or a token Ora does not know, the request still runs, as an anonymous caller under per-IP limits. Those limits then apply to all of poppy.ax's traffic at once, because every request comes from poppy.ax's server.

| When | Response |
| --- | --- |
| `domain` missing (or `url` sent instead) | `400`, plain text: `Missing domain parameter` |
| `localhost`, an IP address, or not a domain | `400`, plain text: `Invalid domain. Please provide a real domain (e.g. stripe.com)` |
| Too many requests in a short time (anonymous callers only) | `429`, plain text: `Too many requests - please try again later`, with `Retry-After` (seconds; `60` seen) |
| Daily scan budget spent (anonymous callers only) | `429`, JSON `{"error": "<text>", "retry_after_ms": <number>}`, with `Retry-After` (seconds) |
| A PAP read key sent `force` or `fresh` | `403`, JSON `{"error": "force_not_allowed"}` (from Ora's change set dated 2026-10-11, not yet captured live) |
| A PAP read key spent its daily cap of new scans (see [Limits](#limits)) | `429`, JSON `{"error": "key_daily_cap", "retry_after_ms": <number>}`, with `Retry-After` (seconds) (from Ora's change set dated 2026-10-11, not yet captured live) |
| The domain does not answer | `200` and one frame: `{"type":"error","message":"Domain is not reachable"}`. No `scan_complete`, nothing saved. |
| The scan fails part way | `200`, then an `error` frame |

The two anonymous `429`s mean the token is not being recognised: check it with the summary. A `key_daily_cap` `429` means the opposite: Ora knows the key, and it has used up its new scans for the day. poppy.ax answers every `429` as `busy`, with `retryAfterSeconds` from `Retry-After` or, failing that, `retry_after_ms`, and it logs a `key_daily_cap` once. Treat any other non-`200` status as a failure.

An `error` frame's `message` is free text. It can be Ora's internal error text, so log it and never show it to visitors; show your own words instead. An `error` frame ends the scan. If one arrives after `scan_complete`, the checks may have finished, so fetch the summary as usual.

## `GET /api/pap/v1/summary`

The PAP result of the latest stored scan of one domain.

### Request

`domain`: the host. Ora lowercases it, drops a scheme (`https://example.com`) and removes one leading `www.`. Other subdomains stay as they are: `docs.example.com` is its own domain. Send the host already in that form anyway.

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
| `domain` | The requested host with one leading `www.` removed: the domain the result is stored under. Asking for `www.example.com` returns `"example.com"`. Use this value in poppy.ax URLs (`/audit/www.x` should become `/audit/x`). |
| `profile` | The PAP check profile the run used, such as `pap-0.1@2026-10-09`. Matches the catalog's `profile`. |
| `last_run` | ISO 8601 UTC time of the scan this result comes from. |
| `probed_at` | ISO 8601 UTC time of the active-probe round that the Tier 1 rows show. `null` when no round from the last 30 days is stored. It can be earlier than `last_run` (see [Limits](#limits)). In `fixtures/summary-demo-receiver.json`, `probed_at` is 22:32 and `last_run` 23:51. |
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
| `reason` | Why a `not_tested` row was not measured, or `null`. |
| `note` | A short detail or `null`. **Untrusted:** it can quote the scanned site's own URLs and values. Render it as plain text only, never as HTML or Markdown, and do not turn it into a link. |

The summary gives ids and outcomes only. poppy.ax writes the plain-language explanation of each row, using the catalog's `title` when it has none.

### Errors

Errors have `cache-control: no-store` and a JSON body `{"error": "<code>"}`, except `405`.

| Status | `error` | When |
| --- | --- | --- |
| `400` | `invalid_domain` | Not a domain, or `domain` missing or empty |
| `400` | `has_path` | A path, such as `example.com/path` |
| `400` | `has_port` | A port, such as `example.com:8443` |
| `400` | `ip_address` | An IP address |
| `400` | `localhost` | `localhost` |
| `401` | `unauthorized` | No token, an unknown token, or a token without PAP read access. All three look the same. |
| `404` | `not_scanned` | No PAP result is stored for the domain. Either Ora has never scanned it, or its last scan predates the PAP checks. Start a scan. |
| `405` | none (empty body) | `POST`, `PUT`, `PATCH` or `DELETE` |
| `500` | `internal_error` | Ora could not read the result. Retry once after 2 seconds, then show a failure. |

## Verdicts

| `verdict` | Meaning | Fixture |
| --- | --- | --- |
| `not_set_up` | No valid `poppy.json` was found. In the captures (example.com, example.org) every Tier 0 and Tier 1 row is `na`, and T0-01's note gives the reason, such as `No poppy.json: HTTP 404`. | `summary-not-set-up.json` (example.com) |
| `unreachable` | Ora could not measure `poppy.json`: it never answered. Every Tier 0 and Tier 1 row is `not_tested` with reason `timeout`. | `summary-unreachable.json` |
| `not_checked` | Ora's own discovery check failed, so nothing was measured. This says nothing about the site: show it as Ora's failure, never the site's. Every Tier 0 and Tier 1 row is `not_tested` with reason `check_error`. Before this change, Ora answered `unreachable` here. Ora does not serve this result from its freshness cache, so the next check runs fresh at once (both from Ora's change set dated 2026-10-11, not yet captured live). | none: the tests build one from `summary-unreachable.json` |
| `problems` | At least one P0 or P1 row failed. | `summary-failing-p0.json` (T0-11, P0) |
| `working` | `poppy.json` is there and no measured P0 or P1 row failed. | `summary-demo-receiver.json` |

`working` does not mean every P0 and P1 row was measured. Read `rows` for P0 and P1 rows that are `not_tested` or `blocked`. In `summary-timeout.json` four P0 rows are `not_tested` (timeout) and the verdict is still `working`. In `summary-owner-opt-out.json` two Tier 1 rows were not probed. Show those rows next to the verdict.

## Outcomes and reasons

| `outcome` | Meaning |
| --- | --- |
| `pass` | The check passed. |
| `fail` | The check failed. `severity` says how much it matters. |
| `na` | Does not apply to this site. Examples: browser rows on a site with no browser endpoint (T1-07 on the demo receiver), or every row on a site with no `poppy.json`. |
| `blocked` | The site answered with something the spec does not define, such as a firewall page, a bot challenge or a 5xx. It never counts as a failure. No captured response had one; show it as not measured. |
| `not_tested` | Ora did not measure the row. `reason` and `note` say why. |

Every `reason` value:

| `reason` | Meaning |
| --- | --- |
| `timeout` | The site did not answer in time, after a retry where Ora retries. In the timeout fixture, T0-09 notes `timed out twice` and the rows that depend on it note `issuer metadata unavailable`. |
| `deadline` | Ora's time budget for the PAP checks ran out before this row. |
| `probe_cooldown` | Ora probed this target recently and is waiting before it probes again. This is Ora's own limit, not the spec's `rate_limited` error. |
| `owner_opt_out` | The domain's verified owner turned active probes off. |
| `out_of_scope` | The target is off the domain, a refused private address, or past one of Ora's size or count limits. |
| `not_available` | Ora does not run these checks yet: every Tier 2a and Tier 3 row. Show as "coming soon". |
| `opt_in_required` | These run only for a verified owner who opts in: every Tier 2b row. |
| `check_error` | Ora's own check failed to run, so nothing was measured. Never show it as N/A. On a `not_checked` summary every Tier 0 and Tier 1 row has it (from Ora's change set dated 2026-10-11, not yet captured live). |
| `null` | Not measured, with no single cause. On Tier 1 the captured note reads: "Active probes run only on a scan requested for this domain. No probe result from the last 30 days." |

Only `not_tested` rows carry a reason. Treat any reason not listed here as "not measured", with generic text. The fixtures contain `timeout`, `owner_opt_out`, `not_available`, `opt_in_required` and `null`; the other values were not seen in a capture.

## `GET /api/pap/v1/sites`

Hosts where a scan found a `poppy.json` that parses and whose `organization.domain` names the host itself (row T0-05 passes). No verdicts and no pass or fail data.

`200`, `content-type: application/json`, `cache-control: private, max-age=300`:

```json
{
  "sites": [
    {
      "domain": "poppy-receiver.roundtrip.workers.dev",
      "first_seen": "2026-10-10T22:32:42.042Z",
      "last_seen": "2026-10-10T23:51:40.290Z"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `domain` | The host, stored as the summary stores it. |
| `first_seen` | ISO 8601 UTC time a scan first found its `poppy.json`. |
| `last_seen` | ISO 8601 UTC time of the latest scan that found it. |

How the list is built:

- Newest `last_seen` first, at most 1000 entries.
- At most 5 hosts per registrable domain.
- Left out: test domains (reserved names such as `.example` and `.test`), hosts an Ora operator hid, and domains whose verified owner asked to be left out.

So the list is not every site that publishes `poppy.json`: Ora lists only hosts it has scanned. poppy.ax sends no parameters. Errors are as for the summary: `401 unauthorized` and `500 internal_error`.

## `GET /pap/catalog.json`

The full check catalog, generated from the rules Ora runs. It is public, so no token is needed. `200`, `content-type: application/json; charset=utf-8`. When captured, the response had `cache-control: public, max-age=3600`; treat that as Ora's current choice, not a promise. poppy.ax ships a copy in `fixtures/catalog.json`.

Top level:

| Field | Meaning |
| --- | --- |
| `profile` | The check profile, such as `pap-0.1@2026-10-09`. |
| `spec_version` | The spec version the checks follow, such as `"0.1"`. |
| `draft` | `true` while that spec is a draft that may change. |
| `spec_url` | The PAP spec, `https://personalagentprotocol.org/docs/spec`. |
| `generated_from` | `"ora"`. |
| `tier1_policy` | One sentence on when Ora sends Tier 1 requests. Ora sends them only on a scan that asks for active probes, and at most once per target domain every 6 hours. It never sends them to a domain whose verified owner turned them off. |
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
| `implemented` | `true` when Ora runs the check today: Tiers 0 and 1, 37 rows. `false` for Tier 2 and Tier 3 (63 rows). |
| `provisional` | `true` for a planned check whose details may still change. Today it is `true` exactly when `implemented` is `false`. |
| `request` | For a check that sends its own request: `{ "method", "target", "condition" }`. Example: `GET`, `https://{domain}/.well-known/poppy.json`, "on every scanned domain". `null` otherwise. `target` is a description, not always a URL. |
| `pass_when` | One line saying what passes. Every row has one. On rows Ora runs, it states Ora's rule. Rows starting "Ora consistency check, not a spec requirement:" are Ora's own cross-checks. |
| `replaces` | The id of an older row this one supersedes, such as `T1-04` for `T2-M1`, or `null`. |

## Limits

- **Stored results: 6 hours.** A stream request for a domain checked in the last 6 hours normally returns the stored result and runs nothing (see [A stored result](#response)).
- **Active probes: one round per registrable domain per 6 hours.** The limit covers sibling hosts too: `a.example.com` and `b.example.com` share one round. It is also shared with the issuer the site's `poppy.json` names. A scan inside the window keeps the last stored round's Tier 1 results, from up to 30 days back, and `probed_at` says when that round ran. With no stored round, `probed_at` is `null`, and on a site with a `poppy.json` the Tier 1 rows are `not_tested`. No parameter changes this.
- **Never send `force` or `fresh`.** Each skips the stored result and runs a full new scan every time. Ora refuses either from a PAP read key with `403` `{"error": "force_not_allowed"}` (from Ora's change set dated 2026-10-11, not yet captured live).
- **Daily cap per PAP read key: 10,000 new scans per UTC day.** Only scans Ora actually runs count; a stored result served from the 6-hour window is free. Past the cap the stream answers `429` `{"error": "key_daily_cap", "retry_after_ms": <number>}` with `Retry-After`, until the next UTC day. poppy.ax shows it as busy, with the wait (from Ora's change set dated 2026-10-11, not yet captured live).
- **Rate-limit visitors yourself.** Every request reaches Ora from poppy.ax's server with the same token, so Ora cannot tell visitors apart. poppy.ax must limit checks per visitor IP at its own edge before it calls the stream.

## Caching

| Response | `cache-control` |
| --- | --- |
| Summary `200` | `private, max-age=60` |
| Sites `200` | `private, max-age=300` |
| Catalog | `public, max-age=3600` when captured |
| Stream | `no-cache` (and `Age` on a stored result) |
| Summary and sites errors | `no-store` |

Right after a scan, fetch the summary without any cache. A cached summary from before the scan, or from an earlier poll, would show the old result for up to 60 seconds. At other times, caching the summary and sites list for their `max-age` is fine.
