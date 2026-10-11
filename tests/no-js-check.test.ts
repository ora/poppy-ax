import { describe, expect, it } from "vitest";
import { GET as noJsGet } from "@/app/audit/route";
import { DOMAIN_MESSAGES } from "@/lib/domain";
import { domainMessageCode } from "@/lib/no-js-check";

describe("GET /audit (the domain box without JavaScript)", () => {
  function go(query: string): Response {
    return noJsGet(new Request(`http://poppy.test/audit${query}`));
  }

  it.each([
    ["?domain=example.com", "/audit/example.com"],
    ["?domain=WWW.Example.com", "/audit/example.com"],
    ["?domain=https%3A%2F%2Fexample.com%2F", "/audit/example.com"],
    ["?domain=b%C3%BCcher.de", "/audit/xn--bcher-kva.de"],
  ])("sends %s to %s with a 307", (query, location) => {
    const response = go(query);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(location);
  });

  it.each([
    ["?domain=example.com%2Fpath", "has_path"],
    ["?domain=example.com%3A8443", "has_port"],
    ["?domain=127.0.0.1", "ip_address"],
    ["?domain=localhost", "localhost"],
    ["?domain=me%40example.com", "email"],
    ["?domain=", "empty"],
    ["", "empty"],
  ])("sends %s back home with the code %s", (query, code) => {
    const response = go(query);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`/?error=${code}#domain-error-${code}`);
  });
});

describe("domainMessageCode", () => {
  it("names the exact message the domain box would show", () => {
    expect(domainMessageCode("example.com")).toBeNull();
    for (const input of ["", "http:example.com", "ftp://example.com", "a b.com", "me@example.com", "co.uk"]) {
      const code = domainMessageCode(input);
      expect(code && Object.hasOwn(DOMAIN_MESSAGES, code)).toBe(true);
    }
    expect(domainMessageCode("co.uk")).toBe("suffix");
  });
});
