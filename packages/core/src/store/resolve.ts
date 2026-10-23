import { PLAY_REFERRER_MAX } from "../constants";
import { ANDROID_STORE_CHAIN } from "../data/stores";
import type { Env, RuntimeConfig, StoreId } from "../types";

export interface ResolvedStore {
  store: StoreId;
  url: string;
}

type Apps = RuntimeConfig["apps"];

const hit = (store: StoreId, url: string | undefined): ResolvedStore | null => (url ? { store, url } : null);

/**
 * The store that suits this device, or null when the platform has an app but nowhere to install it from
 * (the router then falls through to the web app). URLs are returned exactly as configured.
 * Browser bundle: no `?.` or `??` (see decide.ts).
 */
export function resolveStore(env: Env, apps: Apps): ResolvedStore | null {
  const { ios, android, macos, windows, linux, chromeos } = apps;
  switch (env.os) {
    case "ios":
    case "ipados":
      return hit("appstore", ios && ios.storeUrl);

    case "android":
    case "harmonyos": {
      if (!android) return null;
      const eligible = ANDROID_STORE_CHAIN[env.ecosystem || (env.os === "harmonyos" ? "huawei" : "google")];
      // `priority` decides among the stores this device can use; stores it does not list are never chosen.
      for (const id of android.priority) {
        const url = android.stores[id];
        if (url && eligible.indexOf(id) >= 0) return { store: id, url };
      }
      return null;
    }

    case "chromeos":
      return chromeos && chromeos.useAndroidApp ? hit("google", android && android.stores.google) : null;

    case "macos":
      return macos ? hit("macappstore", macos.storeUrl) || hit("download", macos.downloadUrl) : null;

    case "windows":
      return windows ? hit("microsoft", windows.storeUrl) || hit("download", windows.downloadUrl) : null;

    case "linux":
      return linux
        ? hit("flathub", linux.stores.flathub) ||
            hit("snap", linux.stores.snap) ||
            hit("download", linux.downloadUrl)
        : null;

    default:
      return null;
  }
}

/**
 * Adds the full original URL, URL-encoded, as Google Play's `referrer` so the app can read it back through the
 * Install Referrer API. A referrer already on the store URL is left alone, and a value over the 512-character cap
 * is omitted rather than truncated (a cut-off URL would deep-link somewhere wrong).
 */
export function withPlayReferrer(storeUrl: string, originalUrl: string): string {
  if (/[?&]referrer=/.test(storeUrl)) return storeUrl;
  const value = encodeURIComponent(originalUrl);
  if (value.length > PLAY_REFERRER_MAX) return storeUrl;
  const hash = storeUrl.indexOf("#");
  const head = hash < 0 ? storeUrl : storeUrl.slice(0, hash);
  return (
    head + (head.indexOf("?") < 0 ? "?" : "&") + "referrer=" + value + (hash < 0 ? "" : storeUrl.slice(hash))
  );
}
