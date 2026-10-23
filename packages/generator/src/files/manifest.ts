import type { ResolvedConfig } from "@deeplinker/core";
import type { Built } from "../types";

export interface RelatedApplication {
  platform: string;
  id?: string;
  url?: string;
}

export interface ManifestFragment {
  related_applications?: RelatedApplication[];
  prefer_related_applications?: boolean;
  handle_links?: "preferred" | "not-preferred";
}

/** `https://apps.microsoft.com/detail/<id>` from an `ms-windows-store://pdp/?ProductId=<id>` link. */
function microsoftStoreUrl(storeUrl: string | undefined): string | undefined {
  if (!storeUrl) return undefined;
  const id = /[?&]ProductId=([A-Za-z0-9]+)/i.exec(storeUrl)?.[1];
  if (id) return `https://apps.microsoft.com/detail/${id}`;
  return /^https?:\/\//i.test(storeUrl) ? storeUrl : undefined;
}

/**
 * The web app manifest members that point at the native apps. Platform names come from the W3C registry
 * (play, amazon, windows, chromeos_play, ...); it has no value for the iOS App Store, so iOS is not listed.
 * `prefer_related_applications` is stated as false so Chromium keeps the PWA installable. `handle_links` is only
 * written when it is not the default (`auto`). The obsolete `capture_links` is never written.
 * https://developer.mozilla.org/en-US/docs/Web/Manifest/related_applications
 */
export function buildManifestFragment(c: ResolvedConfig): Built<ManifestFragment> {
  const pwa = c.web?.pwa;
  const android = c.apps.android;
  const windows = c.apps.windows;
  const related: RelatedApplication[] = [];

  if (android?.packageName && android.stores?.google) {
    related.push({ platform: "play", id: android.packageName, url: android.stores.google });
  }
  if (android?.stores?.amazon) related.push({ platform: "amazon", url: android.stores.amazon });
  if (windows) {
    const url = microsoftStoreUrl(windows.storeUrl);
    if (windows.packageFamilyName || url) {
      related.push({
        platform: "windows",
        ...(windows.packageFamilyName && { id: windows.packageFamilyName }),
        ...(url && { url }),
      });
    }
  }
  if (c.apps.chromeos?.useAndroidApp && android?.packageName && android.stores?.google) {
    related.push({ platform: "chromeos_play", id: android.packageName });
  }

  const fragment: ManifestFragment = {};
  if (related.length) {
    fragment.related_applications = related;
    fragment.prefer_related_applications = pwa?.preferRelatedApplications ?? false;
  }
  if (pwa && pwa.handleLinks !== "auto") fragment.handle_links = pwa.handleLinks;

  return { value: Object.keys(fragment).length ? fragment : null, warnings: [] };
}
