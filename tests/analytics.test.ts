import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));

import { cleanProps, EVENT_NAMES, referrerHost, trackEvent } from "@/lib/analytics";
import { TrackedLink } from "@/components/analytics/tracked-link";

beforeEach(() => track.mockClear());

describe("referrerHost", () => {
  it("keeps only the host", () => {
    expect(referrerHost("https://News.Example.com/a/b?q=secret#frag")).toBe("news.example.com");
    expect(referrerHost("http://example.com:8080/x")).toBe("example.com");
  });
  it("is empty for direct, junk and non-web referrers", () => {
    expect(referrerHost("")).toBe("");
    expect(referrerHost(undefined)).toBe("");
    expect(referrerHost("not a url")).toBe("");
    expect(referrerHost("android-app://com.google.android.gm")).toBe("");
  });
});

describe("trackEvent", () => {
  it("has the seven closed names", () => {
    expect(EVENT_NAMES).toHaveLength(7);
  });
  it("drops unknown keys", () => {
    trackEvent("domain_checked", { domain: "example.com", email: "a@b.co", ip: "1.2.3.4" } as never);
    expect(track).toHaveBeenCalledWith("domain_checked", { domain: "example.com" });
  });
  it("drops full URLs, paths and addresses", () => {
    expect(cleanProps({ domain: "https://example.com/path" })).toEqual({});
    expect(cleanProps({ domain: "example.com/path?x=1" })).toEqual({});
    expect(cleanProps({ domain: "user@example.com" })).toEqual({});
    expect(cleanProps({ referrer_host: "https://a.com/p" })).toEqual({});
    expect(cleanProps({ verdict: "https://x.test" })).toEqual({});
  });
  it("keeps a direct visit as an empty referrer host", () => {
    expect(cleanProps({ referrer_host: "" })).toEqual({ referrer_host: "" });
  });
  it("keeps verdict and level", () => {
    expect(cleanProps({ verdict: "not_set_up", level: 2 })).toEqual({ verdict: "not_set_up", level: 2 });
  });
  it("ignores an unknown event name", () => {
    trackEvent("page_loaded" as never);
    expect(track).not.toHaveBeenCalled();
  });
  it("never throws when track does", () => {
    track.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => trackEvent("waitlist_clicked")).not.toThrow();
  });
});

describe("TrackedLink", () => {
  it("tracks its event on click, then runs the caller's handler", () => {
    const onClick = vi.fn();
    const el = TrackedLink({
      href: "https://ora.ai/pap/managed",
      event: "full_report_clicked",
      eventProps: { domain: "example.com" },
      onClick,
      children: "Report",
    });
    expect(el.props.href).toBe("https://ora.ai/pap/managed");
    el.props.onClick({} as never);
    expect(track).toHaveBeenCalledWith("full_report_clicked", { domain: "example.com" });
    expect(onClick).toHaveBeenCalled();
  });
});
