import type { Loc } from "../types";

export interface UrlParts extends Loc {
  /** `scheme://authority`, or "" for a bare path. */
  origin: string;
}

const URL_RE = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*))?([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/;

/**
 * Splits a URL by slicing the string, never by parsing it, so the query and the hash come back exactly as
 * written: repeated keys, empty values, `+` versus `%20`, unicode, a trailing `?` or a lone `#`.
 * Always feed it `location.href`: `location.search` drops a bare `?`.
 */
export function splitUrl(href: string): UrlParts {
  const m = URL_RE.exec(href) as RegExpExecArray;
  const origin = m[1] || "";
  const pathname = m[2] || (origin ? "/" : "");
  return { origin, pathname, search: m[3] || "", hash: m[4] || "" };
}

/** `base` may carry a path prefix (`https://example.com/app/`); a query or hash on `base` is ignored. */
export function joinUrl(base: string, pathname: string, search: string, hash: string): string {
  const b = splitUrl(base);
  return b.origin + b.pathname.replace(/\/+$/, "") + pathname + search + hash;
}
