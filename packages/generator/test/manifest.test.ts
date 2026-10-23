import { describe, expect, it } from "vitest";
import { buildManifestFragment, type ManifestFragment } from "../src/files/manifest";
import { mergeManifest } from "../src/merge/manifest";
import { FP, resolved } from "./helpers";

const PLAY = "https://play.google.com/store/apps/details?id=com.example.app";

const apps = {
  android: { packageName: "com.example.app", sha256CertFingerprints: [FP], stores: { google: PLAY } },
  windows: {
    packageFamilyName: "Example_abc123xyz",
    storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
  },
  ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
};

describe("manifest fragment", () => {
  it("emits play and windows entries, and no iOS entry (the registry has no value for it)", () => {
    const fragment = buildManifestFragment(resolved({ apps })).value;
    expect(fragment?.related_applications).toEqual([
      { platform: "play", id: "com.example.app", url: PLAY },
      { platform: "windows", id: "Example_abc123xyz", url: "https://apps.microsoft.com/detail/9NBLGGH4NNS1" },
    ]);
    expect(JSON.stringify(fragment)).not.toContain("itunes");
  });

  it("adds amazon and chromeos_play entries when configured", () => {
    const fragment = buildManifestFragment(
      resolved({
        apps: {
          android: {
            packageName: "com.example.app",
            sha256CertFingerprints: [FP],
            stores: { google: PLAY, amazon: "https://www.amazon.com/gp/mas/dl/android?p=com.example.app" },
          },
          chromeos: { useAndroidApp: true },
        },
      }),
    ).value;
    expect(fragment?.related_applications).toEqual([
      { platform: "play", id: "com.example.app", url: PLAY },
      { platform: "amazon", url: "https://www.amazon.com/gp/mas/dl/android?p=com.example.app" },
      { platform: "chromeos_play", id: "com.example.app" },
    ]);
  });

  it("uses an https Microsoft Store URL as given", () => {
    const fragment = buildManifestFragment(
      resolved({
        apps: {
          windows: {
            packageFamilyName: "Example_abc123xyz",
            storeUrl: "https://apps.microsoft.com/detail/9nblggh4nns1",
          },
        },
      }),
    ).value;
    expect(fragment?.related_applications).toEqual([
      { platform: "windows", id: "Example_abc123xyz", url: "https://apps.microsoft.com/detail/9nblggh4nns1" },
    ]);
  });

  it("never emits capture_links", () => {
    const fragment = buildManifestFragment(
      resolved({ apps, web: { pwa: { handleLinks: "preferred" } } }),
    ).value;
    expect(JSON.stringify(fragment)).not.toContain("capture_links");
  });

  it("states prefer_related_applications: false so the PWA stays installable", () => {
    expect(buildManifestFragment(resolved({ apps })).value?.prefer_related_applications).toBe(false);
  });

  it("emits prefer_related_applications: true only when asked", () => {
    const fragment = buildManifestFragment(
      resolved({ apps, web: { pwa: { preferRelatedApplications: true } } }),
    ).value;
    expect(fragment?.prefer_related_applications).toBe(true);
  });

  it("emits handle_links only when it is not the default (auto)", () => {
    expect(buildManifestFragment(resolved({ apps })).value?.handle_links).toBeUndefined();
    expect(
      buildManifestFragment(resolved({ apps, web: { pwa: { handleLinks: "preferred" } } })).value
        ?.handle_links,
    ).toBe("preferred");
    expect(
      buildManifestFragment(resolved({ apps, web: { pwa: { handleLinks: "not-preferred" } } })).value
        ?.handle_links,
    ).toBe("not-preferred");
  });

  it("handle_links alone is still a fragment", () => {
    const fragment = buildManifestFragment(resolved({ web: { pwa: { handleLinks: "preferred" } } })).value;
    expect(fragment).toEqual({ handle_links: "preferred" });
  });

  it("is null when there is nothing to say", () => {
    expect(buildManifestFragment(resolved({})).value).toBeNull();
    expect(buildManifestFragment(resolved({ apps: { ios: apps.ios } })).value).toBeNull();
  });
});

describe("mergeManifest", () => {
  const fragment: ManifestFragment = {
    related_applications: [{ platform: "play", id: "com.example.app", url: PLAY }],
    prefer_related_applications: false,
    handle_links: "preferred",
  };
  const user = {
    name: "Example",
    short_name: "Ex",
    start_url: "/",
    display: "standalone",
    icons: [{ src: "/i.png" }],
  };

  it("adds the fragment to a manifest without touching any user field", () => {
    const { merged, conflicts, added } = mergeManifest(user, fragment);
    expect(merged).toEqual({ ...user, ...fragment });
    expect(Object.keys(merged).slice(0, 5)).toEqual(Object.keys(user));
    expect(conflicts).toEqual([]);
    expect(added).toEqual(["related_applications", "prefer_related_applications", "handle_links"]);
  });

  it("keeps the user's prefer_related_applications: true and reports no change", () => {
    const { merged, conflicts, added } = mergeManifest(
      { ...user, prefer_related_applications: true },
      fragment,
    );
    expect(merged.prefer_related_applications).toBe(true);
    expect(added).not.toContain("prefer_related_applications");
    expect(conflicts.join("\n")).toContain("prefer_related_applications");
  });

  it("keeps a different user handle_links and lists it as a conflict", () => {
    const { merged, conflicts } = mergeManifest({ ...user, handle_links: "not-preferred" }, fragment);
    expect(merged.handle_links).toBe("not-preferred");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("handle_links");
    expect(conflicts[0]).toContain("not-preferred");
    expect(conflicts[0]).toContain("preferred");
  });

  it("an identical user value is neither added nor a conflict", () => {
    const { conflicts, added } = mergeManifest({ ...user, handle_links: "preferred" }, fragment);
    expect(conflicts).toEqual([]);
    expect(added).not.toContain("handle_links");
  });

  it("does not re-add an existing play entry, matched by id or by url", () => {
    const byId = mergeManifest(
      { ...user, related_applications: [{ platform: "play", id: "com.example.app" }] },
      fragment,
    );
    expect(byId.merged.related_applications).toEqual([{ platform: "play", id: "com.example.app" }]);
    expect(byId.added).not.toContain("related_applications");
    const byUrl = mergeManifest(
      { ...user, related_applications: [{ platform: "play", url: PLAY }] },
      fragment,
    );
    expect(byUrl.merged.related_applications).toEqual([{ platform: "play", url: PLAY }]);
  });

  it("appends to the user's other related applications", () => {
    const other = { platform: "webapp", url: "https://example.com/manifest.json" };
    const { merged, added } = mergeManifest({ ...user, related_applications: [other] }, fragment);
    expect(merged.related_applications).toEqual([other, fragment.related_applications?.[0]]);
    expect(added).toContain("related_applications");
  });

  it("leaves a related_applications that is not an array alone and says so", () => {
    const { merged, conflicts } = mergeManifest({ ...user, related_applications: "nope" }, fragment);
    expect(merged.related_applications).toBe("nope");
    expect(conflicts.join("\n")).toContain("related_applications");
  });

  it("with no existing manifest, the fragment is the manifest", () => {
    expect(mergeManifest(undefined, fragment).merged).toEqual(fragment);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(user);
    mergeManifest(user, fragment);
    expect(JSON.stringify(user)).toBe(snapshot);
  });
});
