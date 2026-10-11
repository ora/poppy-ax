import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSiteRows, buildSitesView, formatFirstSeen } from "@/lib/sites";
import type { Site } from "@/lib/ora/types";

const fixtureSites = (JSON.parse(readFileSync(join(process.cwd(), "fixtures", "sites.json"), "utf8")) as { sites: Site[] }).sites;

describe("buildSiteRows", () => {
  it("builds a row from the fixture with a plain date and a result link", () => {
    expect(buildSiteRows(fixtureSites)).toEqual([
      {
        domain: "poppy-receiver.roundtrip.workers.dev",
        isoDate: "2026-10-10",
        firstSeen: "10 October 2026",
        href: "/audit/poppy-receiver.roundtrip.workers.dev",
      },
    ]);
  });

  it("keeps the order Ora sent", () => {
    const sites: Site[] = [
      { domain: "b.test", first_seen: "2026-10-02T00:00:00Z", last_seen: "2026-10-02T00:00:00Z" },
      { domain: "a.test", first_seen: "2026-10-05T00:00:00Z", last_seen: "2026-10-05T00:00:00Z" },
    ];
    expect(buildSiteRows(sites).map((row) => row.domain)).toEqual(["b.test", "a.test"]);
  });

  it("uses the UTC day, not the local one", () => {
    expect(formatFirstSeen("2026-10-31T23:59:59Z")).toEqual({ isoDate: "2026-10-31", text: "31 October 2026" });
  });

  it("leaves out a row whose date cannot be read", () => {
    const bad: Site = { domain: "x.test", first_seen: "soon", last_seen: "soon" };
    expect(buildSiteRows([bad])).toEqual([]);
  });
});

describe("buildSitesView", () => {
  it("is unavailable for null, empty for no rows, a list otherwise", () => {
    expect(buildSitesView(null)).toEqual({ kind: "unavailable" });
    expect(buildSitesView([])).toEqual({ kind: "empty" });
    expect(buildSitesView(fixtureSites).kind).toBe("list");
  });
});
