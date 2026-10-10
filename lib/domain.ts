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
  typo: "Check the address, it looks like a typo near the start. Type just the domain, like example.com.",
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
// "http:example.com", "https:/example.com": a web scheme missing a slash.
const SCHEME_TYPO = /^https?:(?!\/\/)/;
const NUMERIC_LABEL = /^(0x[0-9a-f]*|[0-9]+)$/;
const ASCII_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** The last label of a host is numeric, so the URL standard reads it as IPv4. */
function looksLikeIpv4(host: string): boolean {
  return NUMERIC_LABEL.test(host.split(".").pop() ?? "");
}

/**
 * The host in ASCII, by the URL standard's host parser, which runs the same
 * way in the browser and in Node. It lowercases, converts international names
 * to punycode, maps fullwidth letters and dots (U+3002 and friends) to their
 * ASCII forms, and rewrites every IPv4 spelling (127.1, 0x7f.1, 0177.0.0.1)
 * as a dotted quad. Returns null when the parser refuses the host.
 */
function toAsciiHost(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Turn what someone typed into the domain box into the registrable hostname
 * the checker runs against, or say in plain words why it can't be checked.
 *
 * Accepts a bare host or an http(s) URL with at most one trailing slash.
 * Lowercases, drops one trailing dot and a leading "www." (results are kept
 * for the apex), and converts international names to punycode. Its output,
 * fed back in, comes out unchanged.
 */
export function normalizeDomain(input: string): DomainResult {
  let text = input.trim().toLowerCase();
  if (text === "") return fail("empty");
  if (HIDDEN.test(text)) return fail("invalid", DOMAIN_MESSAGES.hidden);
  if (text.includes("\\") || text.includes("%")) return fail("invalid");
  if (SCHEME_TYPO.test(text)) return fail("invalid", DOMAIN_MESSAGES.typo);

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
  const port = colon === -1 ? null : host.slice(colon + 1);
  if (port !== null) {
    if (!/^[0-9]+$/.test(port)) return fail("invalid", DOMAIN_MESSAGES.typo);
    host = host.slice(0, colon);
  }

  // Every check below runs on the ASCII host, so fullwidth and ideographic
  // spellings of a dot, "www" or "localhost" are judged like the plain ones.
  const ascii = toAsciiHost(host);
  if (ascii === null) return fail(looksLikeIpv4(host) ? "ip_address" : "invalid");

  let domain = ascii;
  if (domain.endsWith(".")) domain = domain.slice(0, -1);
  if (domain.startsWith("www.")) domain = domain.slice(4);
  if (domain === "" || domain.split(".").some((label) => label === "")) return fail("invalid");
  if (looksLikeIpv4(domain)) return fail("ip_address");
  if (domain === "localhost" || domain.endsWith(".localhost")) return fail("localhost");
  if (port !== null) return fail("has_port");
  if (rest !== "" && rest !== "/") return fail("has_path");

  if (domain.length > 253 || !domain.split(".").every((label) => ASCII_LABEL.test(label))) return fail("invalid");

  // A registrable domain under a known public suffix (ICANN or private).
  const parsed = parse(domain, { allowPrivateDomains: true });
  if (parsed.isIp) return fail("ip_address");
  if (!parsed.isIcann && !parsed.isPrivate) return fail("invalid");
  if (parsed.domain === null) return fail("invalid", DOMAIN_MESSAGES.suffix);

  return { ok: true, domain };
}
