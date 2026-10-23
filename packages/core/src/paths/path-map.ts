import type { CompiledRoute, Loc } from "../types";
import { joinUrl } from "../url/preserve";
import { decode, queryValues } from "./match";

/**
 * The web-app URL for `loc`, or undefined when the rule that matches says there is none (`to: null`).
 *
 * Runs the rules built by `compileRoute` (see paths/route.ts for what they mean): the first whose path matches, whose
 * query parameters are all present and whose fragment matches wins; no rule matching means the same path, query and
 * fragment on the web app.
 */
export function toWebAppUrl(
  loc: Loc,
  web: { url: string; routes?: readonly CompiledRoute[] },
): string | undefined {
  for (const { p, q, f, t, k } of web.routes || []) {
    const m = new RegExp(p).exec(loc.pathname);
    if (!m) continue;

    // The path's captures as they were written (for `*`), then decoded, then what the query and fragment add.
    const raw = m.slice(1, -1);
    const values = raw.map(decode);
    const wanted: [string | undefined, string][] = (q || []).map(([name, pattern]) => [
      queryValues(loc.search, name)[0],
      pattern,
    ]);
    if (f !== undefined) wanted.push([decode(loc.hash.slice(1)), f]);
    const found = wanted.every(([text, pattern]) => {
      if (text === undefined) return false;
      const hit = pattern ? new RegExp(pattern).exec(text.trim()) : [""];
      if (hit) values.push(...hit.slice(1));
      return hit;
    });
    if (!found) continue;
    if (!t) return undefined;

    const target = t
      .map((part) =>
        typeof part === "string"
          ? part
          : part < 0
            ? (raw[-part - 1] as string)
            : encodeURIComponent(values[part] as string),
      )
      .join("");
    return k
      ? joinUrl(web.url, target + (m[m.length - 1] as string), loc.search, loc.hash)
      : joinUrl(web.url, target, "", "");
  }
  return joinUrl(web.url, loc.pathname, loc.search, loc.hash);
}
