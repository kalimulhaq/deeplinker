import type { PathRule, ResolvedConfig } from "@deeplinker/core";
import type { Built, Json } from "../types";
import { ruleParts } from "../util";

function component(rule: PathRule, exclude: boolean): Json {
  const r = ruleParts(rule);
  const c: Json = {};
  if (r.path !== undefined) c["/"] = r.path;
  if (r.query !== undefined) c["?"] = r.query;
  if (r.fragment !== undefined) c["#"] = r.fragment;
  if (exclude) c.exclude = true;
  return c;
}

/**
 * Excludes first: Apple takes the first component that matches, so an exclude placed after a broad include would
 * never be reached. With no include rules everything not excluded must still open the app, hence the catch-all.
 * https://developer.apple.com/documentation/bundleresources/applinks/details-swift.dictionary/components-swift.dictionary
 */
export function appleComponents(paths: ResolvedConfig["paths"]): Json[] {
  const out = (paths?.exclude ?? []).map((r) => component(r, true));
  const includes = paths?.include ?? [];
  out.push(...includes.map((r) => component(r, false)));
  if (!includes.length) out.push({ "/": "*" });
  return out;
}

/** `.well-known/apple-app-site-association`: modern `appIDs` + `components` form for iOS, iPadOS, macOS and App Clips. */
export function buildAasa(c: ResolvedConfig): Built<Json> {
  const appIds = [...(c.apps.ios?.appIds ?? []), ...(c.apps.macos?.appIds ?? [])].filter(
    (id, i, all) => all.indexOf(id) === i,
  );
  const clip = c.apps.ios?.appClip;
  if (!appIds.length && !clip) return { value: null, warnings: [] };

  const file: Json = {};
  if (appIds.length) file.applinks = { details: [{ appIDs: appIds, components: appleComponents(c.paths) }] };
  if (clip) file.appclips = { apps: [clip] };
  return { value: file, warnings: [] };
}
