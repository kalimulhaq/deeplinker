import type { AndroidStoreId, RuntimeConfig } from "../types";
import { compileRoutes } from "../paths/route";
import type { ResolvedConfig } from "./parse";

/** Drops `undefined` values so the JSON is small and its hash does not depend on how a field was spelled. */
function prune<T>(value: T): T {
  if (Array.isArray(value)) return value.map(prune) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = prune(v);
    return out as T;
  }
  return value;
}

/**
 * The slice of the config the browser needs, with defaults applied. Everything only the generator uses
 * (app IDs, certificate fingerprints, package family name, host settings) is left out, which keeps `deeplinker.js` small.
 */
export function toRuntimeConfig(c: ResolvedConfig): RuntimeConfig {
  const { ios, android, macos, windows, linux, chromeos } = c.apps;
  const apps: RuntimeConfig["apps"] = {};

  if (ios?.storeUrl) apps.ios = { storeUrl: ios.storeUrl };

  if (android && (android.stores || android.scheme || android.packageName)) {
    apps.android = {
      pkg: android.packageName,
      scheme: android.scheme,
      stores: { ...android.stores },
      // The order the stores were written in is the order of preference.
      priority: Object.keys(android.stores ?? {}) as AndroidStoreId[],
    };
  }
  if (macos && (macos.storeUrl || macos.downloadUrl)) {
    apps.macos = { storeUrl: macos.storeUrl, downloadUrl: macos.downloadUrl };
  }
  if (windows && (windows.storeUrl || windows.downloadUrl)) {
    apps.windows = { storeUrl: windows.storeUrl, downloadUrl: windows.downloadUrl };
  }
  // linux.scheme is for the .desktop snippet only: Linux has no verified links and the page does not open custom schemes.
  if (linux && (linux.stores || linux.downloadUrl)) {
    apps.linux = { stores: { ...linux.stores }, downloadUrl: linux.downloadUrl };
  }
  if (chromeos) apps.chromeos = { useAndroidApp: chromeos.useAndroidApp };

  return prune({
    v: 1,
    hosts: c.domains,
    paths: c.paths,
    apps,
    web: c.web?.url ? { url: c.web.url, routes: compileRoutes(c.web.routes) } : undefined,
    behavior: {
      redirect: c.behavior.redirect,
      delayMs: c.behavior.redirectDelayMs,
      inAppEscape: !c.behavior.redirectInAppBrowsers,
      bots: !c.behavior.redirectBots,
      guardParam: c.behavior.skipParam,
    },
    deferred: c.deferred.enabled ? { url: `${c.deferred.basePath}/click` } : undefined,
    debug: c.debug,
  } as RuntimeConfig);
}

/** cyrb53: a small, fast, non-cryptographic 53-bit hash. Good enough to notice that a config changed. */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return value;
}

/** 14 hex characters that identify a runtime config, independent of key order. `verify` compares them. */
export function configHash(rc: RuntimeConfig): string {
  return cyrb53(JSON.stringify(canonical(rc)))
    .toString(16)
    .padStart(14, "0");
}
