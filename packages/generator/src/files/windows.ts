import type { ResolvedConfig } from "@deeplinker/core";
import type { Built, Json } from "../types";
import { ruleParts } from "../util";

/**
 * `.well-known/windows-app-web-link`: `[{ packageFamilyName, paths, excludePaths, allowSubdomains }]`. Only path
 * wildcards exist here, so a query or fragment rule cannot be expressed. An include rule falls back to its path
 * (it matches slightly more); an exclude rule is dropped (turning it into a path-only exclude would block more than
 * intended). Windows checks `excludePaths` first.
 * https://learn.microsoft.com/en-us/windows/apps/develop/launch/web-to-app-linking
 */
export function buildWindowsLink(c: ResolvedConfig): Built<Json[]> {
  const w = c.apps.windows;
  if (!w?.packageFamilyName) return { value: null, warnings: [] };

  const warnings: string[] = [];
  const paths: string[] = [];
  const excludePaths: string[] = [];

  for (const rule of c.paths?.include ?? []) {
    const r = ruleParts(rule);
    if (r.query !== undefined || r.fragment !== undefined) {
      warnings.push(
        `windows: web-to-app links match on path only, so the query/fragment part of the include rule for "${r.path ?? "*"}" is ignored (it matches more URLs on Windows).`,
      );
    }
    paths.push(r.path ?? "*");
  }
  for (const rule of c.paths?.exclude ?? []) {
    const r = ruleParts(rule);
    if (r.query !== undefined || r.fragment !== undefined) {
      warnings.push(
        `windows: web-to-app links match on path only, so the exclude rule for "${r.path ?? "*"}" with a query/fragment is left out (excluding the whole path would block too much).`,
      );
      continue;
    }
    if (r.path !== undefined) excludePaths.push(r.path);
  }

  const entry: Json = { packageFamilyName: w.packageFamilyName, paths: paths.length ? paths : ["*"] };
  if (excludePaths.length) entry.excludePaths = excludePaths;
  if (w.allowSubdomains) entry.allowSubdomains = true;
  return { value: [entry], warnings };
}
