import type { PathRule } from "../types";
import { toASCII } from "./punycode";

export type Normalized<T> = { ok: true; value: T } | { ok: false; message: string };

const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^${LABEL}(\\.${LABEL})+$`);

/** Lower-cases, strips a trailing dot, punycodes IDN labels, and rejects anything that is not a bare host name. */
export function normalizeDomain(input: string): Normalized<string> {
  const raw = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return { ok: false, message: `"${input}" is a URL; use only the host name.` };
  }
  if (/[/?#]/.test(raw)) {
    return { ok: false, message: `"${input}" contains a path, query or fragment; use only the host name.` };
  }
  if (raw.includes("@")) {
    return { ok: false, message: `"${input}" contains user info; use only the host name.` };
  }
  if (/:\d*$/.test(raw)) {
    return { ok: false, message: `"${input}" has a port; use only the host name.` };
  }
  if (raw.includes("*")) {
    return { ok: false, message: `"${input}" is a wildcard; list each concrete host name instead.` };
  }
  const host = toASCII(raw.toLowerCase().replace(/\.$/, ""));
  if (host.length > 253 || !HOST_RE.test(host)) {
    return {
      ok: false,
      message: `"${input}" is not a valid host name (it needs at least two labels, such as example.com).`,
    };
  }
  return { ok: true, value: host };
}

/** 32 bytes of hex, with or without colons or spaces, any case → `AA:BB:…`. Returns null when malformed. */
export function normalizeFingerprint(input: string): string | null {
  const hex = input.replace(/[\s:]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return (hex.match(/../g) as string[]).join(":");
}

const STORE_SCHEMES = [
  "https",
  "http",
  "macappstore",
  "itms-apps",
  "ms-windows-store",
  "amzn",
  "market",
  "appmarket",
  "samsungapps",
];

/** Returns an error message, or null when the value is acceptable as an opaque store URL. */
export function checkStoreUrl(input: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(\S+)$/i.exec(input);
  if (!m) return `"${input}" is not a URL (it must start with https:// or a store scheme).`;
  const scheme = (m[1] as string).toLowerCase();
  if (!STORE_SCHEMES.includes(scheme)) {
    return `"${input}" uses the scheme "${scheme}://"; expected https:// or one of ${STORE_SCHEMES.slice(2).join(", ")}.`;
  }
  return null;
}

export function checkHttpUrl(input: string): string | null {
  return /^https?:\/\/[^\s/?#]+(\/\S*)?$/i.test(input) ? null : `"${input}" is not an absolute http(s) URL.`;
}

export function checkAppId(input: string): string | null {
  return /^[A-Za-z0-9]+\.[A-Za-z0-9._-]+$/.test(input)
    ? null
    : `"${input}" is not an app ID; the format is <TeamID>.<BundleID>.`;
}

export function checkPackageName(input: string): string | null {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(input)
    ? null
    : `"${input}" is not an Android application ID (dot-separated segments, e.g. com.example.app).`;
}

export function checkPackageFamilyName(input: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9.-]*_[A-Za-z0-9]+$/.test(input)
    ? null
    : `"${input}" is not a package family name (<Name>_<PublisherId>).`;
}

export function checkScheme(input: string): string | null {
  return /^[a-z][a-z0-9+.-]*$/.test(input)
    ? null
    : `"${input}" is not a valid URL scheme (lower-case letters, digits, + . -).`;
}

/**
 * One entry of `paths`, written the way the URL looks: `path?query#fragment`, with `*` as the only wildcard and a
 * leading `!` for "never". A query part lists parameters that must be present (`?ref=*`, `?type=lead`, or a bare
 * `?ref`); a fragment part matches the whole fragment. Returns the rule the generator and the browser use, or what is
 * wrong with the entry.
 */
export function parsePathEntry(
  entry: string,
): { ok: true; exclude: boolean; rule: PathRule } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message: `"${entry}" ${message}` });
  const exclude = entry.startsWith("!");
  const text = exclude ? entry.slice(1) : entry;
  if (!text.startsWith("/")) return bad('must start with "/" (or "!/" to exclude a path).');

  const hash = text.indexOf("#");
  const fragment = hash < 0 ? undefined : text.slice(hash + 1);
  const rest = hash < 0 ? text : text.slice(0, hash);
  const mark = rest.indexOf("?");
  const path = mark < 0 ? rest : rest.slice(0, mark);
  const queryText = mark < 0 ? undefined : rest.slice(mark + 1);

  if ((queryText ?? "").includes("?") || (fragment ?? "").includes("?")) {
    return bad('has a second "?": "?" starts the query, and there is no one-character wildcard (use *).');
  }
  if (queryText === "") return bad('has nothing after "?". Name a parameter, e.g. /search?ref=*');
  if (fragment === "") return bad('has nothing after "#". Name the fragment, e.g. /promo/*#open');

  let query: Record<string, string> | undefined;
  if (queryText !== undefined) {
    query = {};
    for (const item of queryText.split("&")) {
      const eq = item.indexOf("=");
      const name = eq < 0 ? item : item.slice(0, eq);
      if (!name) return bad("has an empty query parameter name. Write it like /search?ref=*");
      query[name] = eq < 0 ? "*" : item.slice(eq + 1);
    }
  }
  const rule: PathRule =
    query || fragment !== undefined
      ? { path, ...(query && { query }), ...(fragment !== undefined && { fragment }) }
      : path;
  return { ok: true, exclude, rule };
}
