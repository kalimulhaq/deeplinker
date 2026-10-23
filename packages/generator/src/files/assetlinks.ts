import { HANDLE_ALL_URLS, type ResolvedConfig } from "@deeplinker/core";
import type { Built, Json } from "../types";
import { ruleParts } from "../util";

/**
 * Android 15+ dynamic rules (`dynamic_app_link_components`). Same ordering rule as Apple's, and Android opens the
 * app for no URL that matches nothing, so "everything else" needs an explicit catch-all.
 * Keys are `/`, `?` (name/value pairs only), `#` and `exclude`; there is no `comment` and no `caseSensitive`.
 * https://developer.android.com/training/app-links/configure-assetlinks
 */
export function androidComponents(paths: ResolvedConfig["paths"]): {
  components: Json[];
  warnings: string[];
} {
  const components: Json[] = [];
  const warnings: string[] = [];

  const add = (rule: Parameters<typeof ruleParts>[0], exclude: boolean) => {
    const r = ruleParts(rule);
    const c: Json = {};
    if (r.path !== undefined) c["/"] = r.path;
    if (r.query !== undefined) c["?"] = r.query;
    if (r.fragment !== undefined) c["#"] = r.fragment;
    if (exclude) c.exclude = true;
    components.push(c);
  };

  for (const rule of paths?.exclude ?? []) add(rule, true);
  const includes = paths?.include ?? [];
  for (const rule of includes) add(rule, false);
  if (!includes.length) components.push({ "/": "*" });
  return { components, warnings };
}

/** `.well-known/assetlinks.json`: one statement per Android package, every certificate fingerprint. */
export function buildAssetlinks(c: ResolvedConfig): Built<Json[]> {
  const a = c.apps.android;
  if (!a) return { value: null, warnings: [] };

  const apps: { pkg: string; fingerprints: string[] }[] = [];
  if (a.packageName && a.sha256CertFingerprints?.length) {
    apps.push({ pkg: a.packageName, fingerprints: a.sha256CertFingerprints });
  }
  for (const extra of a.otherApps ?? []) {
    apps.push({ pkg: extra.packageName, fingerprints: extra.sha256CertFingerprints });
  }
  if (!apps.length) return { value: null, warnings: [] };

  const hasPaths = !!(c.paths?.include?.length || c.paths?.exclude?.length);
  const dynamic = hasPaths && a.dynamicAppLinkComponents ? androidComponents(c.paths) : null;

  const statements = apps.map((app): Json => {
    const statement: Json = {
      relation: [HANDLE_ALL_URLS],
      target: { namespace: "android_app", package_name: app.pkg, sha256_cert_fingerprints: app.fingerprints },
    };
    if (dynamic) {
      statement.relation_extensions = {
        [HANDLE_ALL_URLS]: { dynamic_app_link_components: dynamic.components },
      };
    }
    return statement;
  });
  return { value: statements, warnings: dynamic?.warnings ?? [] };
}
