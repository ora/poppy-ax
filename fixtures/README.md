# Fixtures

Real responses from Ora's public API, recorded so poppy.ax can run with `ORA_FIXTURES=1`: tests, previews and offline work, with no service token. [ORA_API.md](../ORA_API.md) describes every field.

## How they were captured

On 10 October 2026 (UTC) we ran a local Ora instance and called its public API with a partner key, exactly as poppy.ax does in production. On 11 October, after Ora changed its catalog, sites list and notes, we captured `catalog.json`, `sites.json`, `summary-not-set-up.json` and `summary-demo-receiver.json` again from the stored scans (the demo receiver's had been rescanned at 23:51 UTC). On 19 October, after Ora moved its checks to Personal Agent Protocol Draft 0.2, we captured `catalog.json` again from a local Ora (`GET /pap/catalog.json`); the summaries still carry the profile of the scans they were recorded from.

- `example.com`, `poppy-receiver.roundtrip.workers.dev` and `example.org` were scanned live through the scan stream.
- The four test sites (failing P0, timeout, unreachable, owner opt-out) cannot be scanned live, so Ora stored scans for them that it had built from recorded responses. We then read their summaries through the same public API.

Each file is the response body as Ora returned it, pretty-printed. We changed only the test-site names below. No other value was edited, and no local URL was left in.

## Domain names

The four test sites were stored under reserved test names, which must never appear on poppy.ax. In every file (domain, `report_url`, notes) they are renamed:

| Fixture | Domain in the files |
| --- | --- |
| `summary-failing-p0.json` | `failing-p0.example.com` |
| `summary-timeout.json` | `timeout.example.com` |
| `summary-unreachable.json` | `unreachable.example.com` |
| `summary-owner-opt-out.json` | `opt-out.example.com` |

These names are made up; Ora never scanned them. `example.com` in `summary-not-set-up.json` and `example.org` in `scan-in-progress.sse` are real scans of those domains.

## Files

| File | Request | What it shows |
| --- | --- | --- |
| `summary-not-set-up.json` | `GET /api/pap/v1/summary?domain=example.com` | Verdict `not_set_up`: no `poppy.json`. T0-01's note gives the reason (`No poppy.json: HTTP 404`). |
| `summary-demo-receiver.json` | `GET /api/pap/v1/summary?domain=poppy-receiver.roundtrip.workers.dev` | Verdict `working` for the public demo receiver. Tier 1 probes ran (`probed_at` is set). The last scan came inside the probe limit, so `probed_at` is earlier than `last_run`. It has no browser endpoint, so T1-07 is `na`. |
| `summary-failing-p0.json` | summary for `failing-p0.example.com` | Verdict `problems`: T0-11 (P0) fails. No probe round yet, so Tier 1 is `not_tested`. |
| `summary-timeout.json` | summary for `timeout.example.com` | Verdict `working` with the issuer-metadata rows (T0-09 to T0-12, T0-21, ADV-PKCE) `not_tested`, reason `timeout`. |
| `summary-unreachable.json` | summary for `unreachable.example.com` | Verdict `unreachable`: `poppy.json` never answered, so every Tier 0 and Tier 1 row is `not_tested`, reason `timeout`. |
| `summary-owner-opt-out.json` | summary for `opt-out.example.com` | Verdict `working`; the owner turned active probes off, so T1-01 and T1-03 are `not_tested`, reason `owner_opt_out`. |
| `sites.json` | `GET /api/pap/v1/sites` | The sites list at capture time: one site. Test domains are never listed. |
| `catalog.json` | `GET /pap/catalog.json` | The full check catalog: 104 rows, with `spec_version`, `draft`, `tier1_policy` and a `pass_when` on every row. |
| `scan-in-progress.sse` | `GET /api/scan/stream?domain=example.org&activeProbes=1` | The first 131 frames of a live scan, up to the tenth `check_complete`. The stream had 279 frames and ended with `scan_complete`. |
| `errors/not-scanned.json` | summary for a domain Ora has not scanned | 404 |
| `errors/invalid-domain.json` | summary with `domain=not_a_domain` (also a missing or empty `domain`) | 400 |
| `errors/has-path.json` | summary with `domain=example.com/path` | 400 |
| `errors/has-port.json` | summary with `domain=example.com:8443` | 400 |
| `errors/ip-address.json` | summary with `domain=127.0.0.1` | 400 |
| `errors/unauthorized.json` | summary with no `Authorization` header | 401 |
| `errors/wrong-scope.json` | summary with a valid key that lacks PAP read access | 401, same body as a missing key |

ORA_API.md lists one more 400 code that has no file here.

## Frozen in time

These are snapshots. `last_run`, `probed_at`, `first_seen` and the stream timestamps are the times of the capture, and the results are what each site served that day. The live API will return newer times and may return different outcomes, and the demo receiver can change at any time. Do not write tests that compare these times with the current date. When Ora's API changes, capture fresh files the same way and update both this folder and ORA_API.md.
