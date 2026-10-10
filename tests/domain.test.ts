import { describe, expect, it } from "vitest";
import { normalizeDomain, type DomainError } from "@/lib/domain";
import { submitStep } from "@/lib/domain-submit";

// Four labels plus ".com": 63 + 1 + 63 + 1 + 63 + 1 + n + 4 characters.
const longHost = (n: number) => ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(n), "com"].join(".");
const HOST_253 = longHost(57);
const HOST_254 = longHost(58);

const accepted: [input: string, domain: string][] = [
  ["example.com", "example.com"],
  ["Example.COM.", "example.com"],
  ["  example.com  ", "example.com"],
  ["https://example.com/", "example.com"],
  ["http://example.com", "example.com"],
  ["https://www.Example.com/", "example.com"],
  ["www.example.com", "example.com"],
  ["example.com/", "example.com"],
  ["bücher.de", "xn--bcher-kva.de"],
  ["BÜCHER.DE", "xn--bcher-kva.de"],
  ["xn--bcher-kva.de", "xn--bcher-kva.de"],
  ["shop.example.co.uk", "shop.example.co.uk"],
  ["poppy-receiver.roundtrip.workers.dev", "poppy-receiver.roundtrip.workers.dev"],
  // Fullwidth letters and dots, and the ideographic full stop.
  ["\uff45\uff58\uff41\uff4d\uff50\uff4c\uff45\uff0e\uff43\uff4f\uff4d", "example.com"],
  ["\uff57\uff57\uff57\uff0eexample.com", "example.com"],
  ["example.com\u3002", "example.com"],
  // 253 characters, the longest a host name can be.
  [HOST_253, HOST_253],
];

const rejected: [input: string, error: DomainError][] = [
  ["", "empty"],
  ["   ", "empty"],
  ["https://example.com/path", "has_path"],
  ["example.com/path", "has_path"],
  ["https://example.com//", "has_path"],
  ["example.com?x=1", "has_path"],
  ["example.com#top", "has_path"],
  ["example.com:8443", "has_port"],
  ["https://example.com:443/", "has_port"],
  ["127.0.0.1", "ip_address"],
  ["127.1", "ip_address"],
  ["0x7f.1", "ip_address"],
  ["2130706433", "ip_address"],
  ["0177.0.0.1", "ip_address"],
  ["\uff11\uff12\uff17\uff0e\uff10\uff0e\uff10\uff0e\uff11", "ip_address"],
  ["1.2.3.4.5", "ip_address"],
  ["http://192.168.0.1/", "ip_address"],
  ["127.0.0.1:8080", "ip_address"],
  ["[::1]", "ip_address"],
  ["[::1]:443", "ip_address"],
  ["::1", "ip_address"],
  ["[fe80::1%25eth0]", "invalid"],
  ["fe80::1%eth0", "invalid"],
  ["2001:db8::1", "ip_address"],
  ["localhost", "localhost"],
  ["localhost:3000", "localhost"],
  ["foo.localhost", "localhost"],
  ["http://www.localhost/", "localhost"],
  ["\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54", "localhost"],
  ["user@example.com", "invalid"],
  ["https://user:pass@example.com/", "invalid"],
  ["example.com\\evil.com", "invalid"],
  ["ex%2Eample.com", "invalid"],
  ["exa\tmple.com", "invalid"],
  ["exa mple.com", "invalid"],
  ["exa\u200bmple.com", "invalid"],
  ["exa\u00admple.com", "invalid"],
  ["exa\ufeffmple.com", "invalid"],
  ["\u200bexample.com", "invalid"],
  ["exa\u0000mple.com", "invalid"],
  ["example", "invalid"],
  ["co.uk", "invalid"],
  ["github.io", "invalid"],
  ["foo.notarealtld", "invalid"],
  ["ftp://example.com", "invalid"],
  ["javascript://example.com", "invalid"],
  ["https://", "invalid"],
  ["example..com", "invalid"],
  [".example.com", "invalid"],
  ["-example.com", "invalid"],
  ["ex_ample.com", "invalid"],
  ["www.", "invalid"],
  [`${"a".repeat(64)}.com`, "invalid"],
  [HOST_254, "invalid"],
  ["http:example.com", "invalid"],
  ["https:/example.com", "invalid"],
  ["https:example.com/", "invalid"],
  ["example.com:abc", "invalid"],
];

describe("normalizeDomain", () => {
  it.each(accepted)("accepts %j as %s", (input, domain) => {
    expect(normalizeDomain(input)).toEqual({ ok: true, domain });
  });

  it.each(rejected)("rejects %j as %s", (input, error) => {
    const result = normalizeDomain(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("explains an IP address in plain words", () => {
    expect(normalizeDomain("127.0.0.1")).toMatchObject({
      message: "That looks like an IP address. Type the company's domain, like example.com.",
    });
  });

  it("gives the same answer for its own output", () => {
    for (const [input] of accepted) {
      const first = normalizeDomain(input);
      if (!first.ok) throw new Error(`${input} was rejected`);
      expect(normalizeDomain(first.domain), input).toEqual(first);
    }
  });

  it("treats fullwidth and plain spellings alike", () => {
    expect(normalizeDomain("\uff57\uff57\uff57\uff0eexample.com")).toEqual(normalizeDomain("www.example.com"));
    expect(normalizeDomain("example.com\u3002")).toEqual(normalizeDomain("example.com."));
  });

  it("calls a scheme missing a slash a typo, not a port", () => {
    for (const input of ["http:example.com", "https:/example.com"]) {
      expect(normalizeDomain(input)).toMatchObject({
        error: "invalid",
        message: "Check the address, it looks like a typo near the start. Type just the domain, like example.com.",
      });
    }
  });

  it("explains a shared ending such as co.uk", () => {
    const result = normalizeDomain("co.uk");
    expect(!result.ok && result.message).toContain("example.co.uk");
  });

  it("writes every message without em dashes or acronyms other than IP", () => {
    const inputs = [...rejected.map(([input]) => input), "user@example.com", "ftp://x.com", "co.uk", "a b.com"];
    for (const input of inputs) {
      const result = normalizeDomain(input);
      if (result.ok) continue;
      expect(result.message).not.toContain(String.fromCharCode(0x2014));
      expect(result.message.replace(/\bIP\b/g, "")).not.toMatch(/\b[A-Z]{2,}\b/);
    }
  });
});

describe("submitStep", () => {
  it("goes to the result page for the clean domain", () => {
    expect(submitStep("https://www.Example.com/", normalizeDomain)).toEqual({ kind: "navigate", path: "/audit/example.com" });
  });

  it("shows the friendly message for input it rejects", () => {
    expect(submitStep("127.0.0.1", normalizeDomain)).toEqual({
      kind: "message",
      message: "That looks like an IP address. Type the company's domain, like example.com.",
    });
  });

  it("sends the raw input to the result page when the normalizer failed to load", () => {
    expect(submitStep("  https://www.Example.com/ ", null)).toEqual({
      kind: "navigate",
      path: "/audit/https%3A%2F%2Fwww.Example.com%2F",
    });
    expect(submitStep("   ", null)).toEqual({ kind: "stay" });
  });
});
