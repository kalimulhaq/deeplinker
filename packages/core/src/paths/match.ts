import type { Loc, PathRule, PathsConfig } from "../types";
import { globToRegExp } from "./glob";

/** A percent-decoded string; text that is not valid percent-encoding is returned as it is. */
export function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Percent-decodes query-string text, where a plus sign is a space. */
const form = (s: string) => decode(s.replace(/\+/g, " "));

/** Every decoded value of the query parameter `name`, in URL order. A bare `?name` has the value "". */
export function queryValues(search: string, name: string): string[] {
  const values: string[] = [];
  for (const pair of search.slice(1).split("&")) {
    const i = pair.indexOf("=");
    if (form(i < 0 ? pair : pair.slice(0, i)) === name) values.push(form(i < 0 ? "" : pair.slice(i + 1)));
  }
  return values;
}

/**
 * Compiles one rule. A string rule matches the path only; an object rule needs every key it names to match. The path
 * is matched as it appears in the URL (percent-encoded), as Apple does; query values are matched decoded.
 */
export function compileRule(rule: PathRule): (loc: Loc) => boolean {
  const r = typeof rule === "string" ? { path: rule } : rule;
  const path = r.path !== undefined && globToRegExp(r.path);
  const fragment = r.fragment !== undefined && globToRegExp(r.fragment);
  const query = r.query || {};
  const wanted = Object.keys(query).map((name) => [name, globToRegExp(query[name] as string)] as const);

  return (loc) =>
    (!path || path.test(loc.pathname)) &&
    (!fragment || fragment.test(loc.hash.slice(1))) &&
    wanted.every(([name, re]) => queryValues(loc.search, name).some((value) => re.test(value)));
}

/**
 * Whether `loc` is one of the configured deep-link paths. An exclude match always wins; with no `include`
 * rules, everything that is not excluded matches.
 */
export function matchesDeepLinkPath(loc: Loc, paths: PathsConfig | undefined): boolean {
  if (!paths) return true;
  if (paths.exclude && paths.exclude.some((rule) => compileRule(rule)(loc))) return false;
  if (!paths.include || !paths.include.length) return true;
  return paths.include.some((rule) => compileRule(rule)(loc));
}
