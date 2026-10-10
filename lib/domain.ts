import { parse } from "tldts";

export type DomainError = "empty" | "invalid" | "ip_address" | "localhost" | "has_port" | "has_path";

export type DomainResult =
  | { ok: true; domain: string }
  | { ok: false; error: DomainError; message: string };

/** Friendly messages for the domain box, in plain words. */
export const DOMAIN_MESSAGES = {
  empty: "Type a domain to check, like example.com.",
  invalid: "That doesn't look like a domain. Type just the company's domain, like example.com.",
  hidden: "That has a space or a hidden character in it. Type the domain again, like example.com.",
  email: "That looks like an email address. Type only the part after the @, like example.com.",
  scheme: "Only web addresses work here. Type the company's domain, like example.com.",
  suffix: "That's an ending many sites share, not one site. Type the full domain, like example.co.uk.",
  ip_address: "That looks like an IP address. Type the company's domain, like example.com.",
  localhost: "That points at your own computer. Type a public domain, like example.com.",
  has_port: "Leave out the colon and the number after it. Type just the domain, like example.com.",
  has_path: "Leave out everything after the domain. The checker looks at the whole site, so example.com is enough.",
} as const;

function fail(error: DomainError, message: string = DOMAIN_MESSAGES[error as keyof typeof DOMAIN_MESSAGES]): DomainResult {
  return { ok: false, error, message };
}

// Whitespace, control characters and invisible format characters (zero-width
// space and joiners, soft hyphen, byte order mark, bidi marks). The URL host
// parser silently drops some of these, so they are refused before parsing.
const HIDDEN = /[\s\p{Cc}\p{Cf}]/u;
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//;
const NUMERIC_LABEL = /^(0x[0-9a-f]*|[0-9]+)$/;
const ASCII_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Turn what someone typed into the domain box into the registrable hostname
 * the checker runs against, or say in plain words why it can't be checked.
 *
 * Accepts a bare host or an http(s) URL with at most one trailing slash.
 * Lowercases, drops one trailing dot and a leading "www." (results are kept
 * for the apex), and converts international names to punycode.
 */
export function normalizeDomain(input: string): DomainResult {
  let text = input.trim().toLowerCase();
  if (text === "") return fail("empty");
  if (HIDDEN.test(text)) return fail("invalid", DOMAIN_MESSAGES.hidden);
  if (text.includes("\\") || text.includes("%")) return fail("invalid");

  const scheme = SCHEME.exec(text);
  if (scheme) {
    if (scheme[1] !== "http" && scheme[1] !== "https") return fail("invalid", DOMAIN_MESSAGES.scheme);
    text = text.slice(scheme[0].length);
  }

  // Split the host from anything after it. One trailing slash is fine.
  const end = text.search(/[/?#]/);
  let host = end === -1 ? text : text.slice(0, end);
  const rest = end === -1 ? "" : text.slice(end);
  if (host.includes("@")) return fail("invalid", DOMAIN_MESSAGES.email);
  if (host === "") return fail("invalid");

  // IPv6 literals, bracketed or bare.
  if (host.startsWith("[") || (host.match(/:/g) ?? []).length > 1) return fail("ip_address");

  // A port. Say what the host is first if that is the bigger problem.
  const colon = host.indexOf(":");
  const hasPort = colon !== -1;
  if (hasPort) host = host.slice(0, colon);

  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("www.")) host = host.slice(4);
  if (host === "" || host.split(".").some((label) => label === "")) return fail("invalid");

  // IPv4 in any spelling the URL parser accepts: 127.0.0.1, 127.1, 0x7f.1,
  // 2130706433. The URL standard treats a host whose last label is numeric
  // as an IPv4 address, so any such host is one (or is not a domain at all).
  const labels = host.split(".");
  if (NUMERIC_LABEL.test(labels[labels.length - 1] ?? "")) return fail("ip_address");

  if (host === "localhost" || host.endsWith(".localhost")) return fail("localhost");
  if (hasPort) return fail("has_port");
  if (rest !== "" && rest !== "/") return fail("has_path");

  // International names to punycode, with the URL standard's host parser,
  // which runs the same way in the browser and in Node.
  let ascii: string;
  try {
    ascii = new URL(`http://${host}`).hostname;
  } catch (error) {
    if (error instanceof TypeError) return fail("invalid");
    throw error;
  }
  if (ascii.length > 253 || !ascii.split(".").every((label) => ASCII_LABEL.test(label))) return fail("invalid");

  // A registrable domain under a known public suffix (ICANN or private).
  const parsed = parse(ascii, { allowPrivateDomains: true });
  if (parsed.isIp) return fail("ip_address");
  if (!parsed.isIcann && !parsed.isPrivate) return fail("invalid");
  if (parsed.domain === null) return fail("invalid", DOMAIN_MESSAGES.suffix);

  return { ok: true, domain: ascii };
}
