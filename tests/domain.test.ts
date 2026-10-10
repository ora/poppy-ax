import { describe, expect, it } from "vitest";
import { normalizeDomain, type DomainError } from "@/lib/domain";

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
  ["http://192.168.0.1/", "ip_address"],
  ["127.0.0.1:8080", "ip_address"],
  ["[::1]", "ip_address"],
  ["[::1]:443", "ip_address"],
  ["::1", "ip_address"],
  ["2001:db8::1", "ip_address"],
  ["localhost", "localhost"],
  ["localhost:3000", "localhost"],
  ["foo.localhost", "localhost"],
  ["http://www.localhost/", "localhost"],
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
