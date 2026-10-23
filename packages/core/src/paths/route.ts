import type { CompiledRoute, PathMapRule } from "../types";

/**
 * Routing rules, compiled when the config is read so the browser only has to run them.
 *
 * A rule is a pair of URL templates, `path?query#fragment` each:
 *
 *   { "from": "/property/:propertyId/leads?id=:leadId", "to": "/property/leads?lead=:leadId&p=:propertyId" }
 *
 * - `:name` (a descriptive name such as `:propertyId`: a letter or `_`, then letters, digits or `_`) captures a whole path segment, a whole query value or
 *   a whole fragment, and `to` can put it anywhere: in the path, in a query value, in the fragment.
 * - `*` (path only) captures anything, slashes included, and comes out as it was written.
 * - Every query parameter named in `from` has to be in the URL (others are allowed and ignored); a value pattern can be
 *   text or a `:name`, a bare `?name` only needs the parameter to be there.
 * - A rule that reads or writes a query or fragment, on either side, builds the target exactly as `to` says. A rule
 *   that is path only keeps the original query, fragment and trailing slash.
 * - `to: null` says this URL has no web equivalent.
 */

const TOKEN = /(:\w+|\*)/;
const escapeRe = (s: string) => s.replace(/[.*+^${}()|[\]\\?]/g, "\\$&");
const QUERY_NAME = /^[\w.~%-]+$/;
/** Matches a whole query value or fragment: anything, but not nothing. */
const VALUE = "([^]+)";

interface Parts {
  path: string;
  query: [name: string, value: string | undefined][];
  fragment: string | undefined;
}

function split(template: string): Parts {
  const hash = template.indexOf("#");
  const fragment = hash < 0 ? undefined : template.slice(hash + 1);
  const rest = hash < 0 ? template : template.slice(0, hash);
  const mark = rest.indexOf("?");
  const query = (mark < 0 ? [] : rest.slice(mark + 1).split("&"))
    .filter((item) => item !== "")
    .map((item): [string, string | undefined] => {
      const eq = item.indexOf("=");
      return eq < 0 ? [item, undefined] : [item.slice(0, eq), item.slice(eq + 1)];
    });
  return { path: mark < 0 ? rest : rest.slice(0, mark), query, fragment };
}

/** What `from` names, in the order the browser will capture it: path, then each query value, then the fragment. */
function captures(from: Parts): string[] {
  const names: string[] = [];
  let stars = 0;
  for (const part of from.path.split(TOKEN)) {
    if (part === "*") names.push("*" + stars++);
    else if (part[0] === ":") names.push(part.slice(1));
  }
  for (const text of [...from.query.map(([, value]) => value), from.fragment])
    for (const part of (text ?? "").split(/(:\w+)/)) if (part[0] === ":") names.push(part.slice(1));
  return names;
}

export interface RouteProblem {
  /** Which half of the rule is wrong. */
  field: "from" | "to";
  message: string;
}

/** What is wrong with this rule, in plain words; an empty list means it is fine. */
export function routeProblems(rule: PathMapRule): RouteProblem[] {
  const problems: RouteProblem[] = [];
  const bad = (field: RouteProblem["field"], message: string) => problems.push({ field, message });
  const from = split(rule.from);
  const names = captures(from);
  const named = names.filter((n) => !n.startsWith("*"));
  const valuesOf = (parts: Parts) => [...parts.query.map(([, value]) => value), parts.fragment];
  const hasStar = (parts: Parts) => valuesOf(parts).some((text) => (text ?? "").includes("*"));

  if (!rule.from.startsWith("/")) bad("from", `"${rule.from}" must start with "/".`);
  for (const [name] of from.query) {
    if (!QUERY_NAME.test(name)) bad("from", `the query name "${name}" must be plain text, with no : or *.`);
  }
  const numbered = [...rule.from.matchAll(/:(\d\w*)/g), ...(rule.to ?? "").matchAll(/:(\d\w*)/g)].map(
    (m) => m[1],
  );
  if (numbered.length) {
    bad(
      rule.from.includes(":" + numbered[0]) ? "from" : "to",
      `:${numbered[0]} is not a name. Start each capture with a letter and say what it holds, such as :propertyId or :leadId.`,
    );
  }
  const twice = named.find((name) => named.indexOf(name) !== named.lastIndexOf(name));
  if (twice) bad("from", `:${twice} appears twice; give each capture its own name.`);
  if (hasStar(from))
    bad("from", "* is only for the path; a query value or fragment is matched whole, or with :name.");

  if (rule.to !== null) {
    const target = split(rule.to);
    const stars = names.filter((n) => n.startsWith("*")).length;
    let used = 0;
    if (!rule.to.startsWith("/")) bad("to", `"${rule.to}" must start with "/".`);
    for (const token of rule.to.split(TOKEN).filter((t) => t === "*" || t[0] === ":")) {
      if (token === "*") used++;
      else if (!/^:\d/.test(token) && !named.includes(token.slice(1))) {
        const have = named.length ? ` (the captures are ${named.map((n) => ":" + n).join(", ")})` : "";
        bad("to", `${token} is not captured by from${have}.`);
      }
    }
    if (used > stars) bad("to", `has ${used} * but from only has ${stars}.`);
    if (hasStar(target))
      bad("to", "* is only for the path; use a :name capture in a query value or fragment.");
  }
  return problems;
}

/** Turns a valid rule into what the browser runs (see CompiledRoute). */
export function compileRoute(rule: PathMapRule): CompiledRoute {
  const from = split(rule.from);
  const names = captures(from);
  const starAt = names.reduce<number[]>((at, n, i) => (n.startsWith("*") ? [...at, i] : at), []);
  let star = 0;
  const target =
    rule.to === null
      ? null
      : rule.to
          .split(TOKEN)
          .map((part, i): string | number => {
            if (i % 2 === 0) return part;
            return part === "*" ? -((starAt[star++] as number) + 1) : names.indexOf(part.slice(1));
          })
          .filter((part) => part !== "");

  const route: CompiledRoute = { p: pathPattern(from), t: target };
  if (from.query.length) {
    route.q = from.query.map(([name, value]) => [name, value === undefined ? "" : valuePattern(value)]);
  }
  if (from.fragment !== undefined) route.f = valuePattern(from.fragment);
  // A rule that leaves the query and fragment alone passes them through; one that touches them says everything itself.
  if (![rule.from, rule.to ?? ""].some((t) => t.includes("?") || t.includes("#"))) route.k = 1;
  return route;
}

/** The path regex: the captures, then a last group that is the optional trailing slash. */
function pathPattern(from: Parts): string {
  return (
    "^" +
    from.path
      .split(TOKEN)
      .map((part, i) => (i % 2 === 0 ? escapeRe(part) : part === "*" ? "(.*)" : "([^/]+)"))
      .join("") +
    "(/?)$"
  );
}

function valuePattern(value: string): string {
  return (
    "^" +
    value
      .split(/(:\w+)/)
      .map((part, i) => (i % 2 === 0 ? escapeRe(part) : VALUE))
      .join("") +
    "$"
  );
}

export const compileRoutes = (rules: readonly PathMapRule[] | undefined): CompiledRoute[] | undefined =>
  rules && rules.length ? rules.map(compileRoute) : undefined;
