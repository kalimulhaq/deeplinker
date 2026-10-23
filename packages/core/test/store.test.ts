import { describe, expect, it } from "vitest";
import { resolveStore, withPlayReferrer } from "../src/store/resolve";
import type { Env, RuntimeConfig } from "../src/types";

const env = (over: Partial<Env>): Env => ({
  os: "android",
  deviceClass: "phone",
  browser: "chrome",
  ecosystem: "google",
  inApp: null,
  bot: null,
  ...over,
});

const PRIORITY = ["huawei", "samsung", "amazon", "xiaomi", "google"] as const;
const GOOGLE = "https://play.google.com/store/apps/details?id=com.example.app";
const SAMSUNG = "https://galaxystore.samsung.com/detail/com.example.app";
const AMAZON = "https://www.amazon.com/gp/mas/dl/android?p=com.example.app";
const HUAWEI = "https://appgallery.huawei.com/app/C123";
const XIAOMI = "https://global.app.mi.com/details?id=com.example.app";

const android = (
  stores: NonNullable<RuntimeConfig["apps"]["android"]>["stores"],
  priority = [...PRIORITY],
) => ({
  android: { stores, priority },
});

describe("resolveStore: Android ecosystems", () => {
  it("a google device gets Google Play", () => {
    expect(resolveStore(env({}), android({ google: GOOGLE, samsung: SAMSUNG }))).toEqual({
      store: "google",
      url: GOOGLE,
    });
  });

  it("a huawei device with only google configured resolves null (it cannot run Play)", () => {
    expect(resolveStore(env({ ecosystem: "huawei" }), android({ google: GOOGLE }))).toBeNull();
  });

  it("a huawei device gets AppGallery when configured", () => {
    expect(resolveStore(env({ ecosystem: "huawei" }), android({ google: GOOGLE, huawei: HUAWEI }))).toEqual({
      store: "huawei",
      url: HUAWEI,
    });
  });

  it("a samsung device prefers the Galaxy Store", () => {
    expect(
      resolveStore(env({ ecosystem: "samsung" }), android({ google: GOOGLE, samsung: SAMSUNG })),
    ).toEqual({
      store: "samsung",
      url: SAMSUNG,
    });
  });

  it("a samsung device falls back to google when samsung is not configured", () => {
    expect(resolveStore(env({ ecosystem: "samsung" }), android({ google: GOOGLE }))).toEqual({
      store: "google",
      url: GOOGLE,
    });
  });

  it("stores written google first: a Samsung device picks google", () => {
    expect(
      resolveStore(
        env({ ecosystem: "samsung" }),
        android({ google: GOOGLE, samsung: SAMSUNG }, ["google", "samsung"] as never),
      ),
    ).toEqual({ store: "google", url: GOOGLE });
  });

  it("a store missing from the priority is never chosen", () => {
    expect(
      resolveStore(
        env({ ecosystem: "samsung" }),
        android({ google: GOOGLE, samsung: SAMSUNG }, ["google"] as never),
      ),
    ).toEqual({
      store: "google",
      url: GOOGLE,
    });
  });

  it("an amazon (Fire OS) device with no amazon URL resolves null", () => {
    expect(
      resolveStore(env({ ecosystem: "amazon", browser: "silk" }), android({ google: GOOGLE })),
    ).toBeNull();
    expect(resolveStore(env({ ecosystem: "amazon" }), android({ google: GOOGLE, amazon: AMAZON }))).toEqual({
      store: "amazon",
      url: AMAZON,
    });
  });

  it("a xiaomi device prefers GetApps, then google", () => {
    expect(
      resolveStore(env({ ecosystem: "xiaomi" }), android({ xiaomi: XIAOMI, google: GOOGLE }))?.store,
    ).toBe("xiaomi");
    expect(resolveStore(env({ ecosystem: "xiaomi" }), android({ google: GOOGLE }))?.store).toBe("google");
  });

  it("harmonyos uses AppGallery only", () => {
    expect(
      resolveStore(env({ os: "harmonyos", ecosystem: "huawei" }), android({ google: GOOGLE, huawei: HUAWEI }))
        ?.store,
    ).toBe("huawei");
    expect(
      resolveStore(env({ os: "harmonyos", ecosystem: "huawei" }), android({ google: GOOGLE })),
    ).toBeNull();
  });

  it("android with no android config resolves null", () => {
    expect(resolveStore(env({}), {})).toBeNull();
  });
});

describe("resolveStore: other platforms", () => {
  const apps: RuntimeConfig["apps"] = {
    ios: { storeUrl: "https://apps.apple.com/app/id123456789" },
    macos: { storeUrl: "macappstore://apps.apple.com/app/id123", downloadUrl: "https://example.com/mac" },
    windows: {
      storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
      downloadUrl: "https://example.com/win",
    },
    linux: {
      stores: { flathub: "https://flathub.org/apps/com.example.app", snap: "https://snapcraft.io/example" },
      downloadUrl: "https://example.com/linux",
    },
    chromeos: { useAndroidApp: true },
    ...android({ google: GOOGLE }),
  };

  it("ios and ipados use the App Store URL", () => {
    expect(resolveStore(env({ os: "ios", ecosystem: null }), apps)).toEqual({
      store: "appstore",
      url: "https://apps.apple.com/app/id123456789",
    });
    expect(resolveStore(env({ os: "ipados", ecosystem: null, deviceClass: "tablet" }), apps)?.store).toBe(
      "appstore",
    );
  });

  it("macos prefers the store URL over the download URL", () => {
    expect(resolveStore(env({ os: "macos", ecosystem: null }), apps)).toEqual({
      store: "macappstore",
      url: "macappstore://apps.apple.com/app/id123",
    });
    expect(
      resolveStore(env({ os: "macos", ecosystem: null }), {
        macos: { downloadUrl: "https://example.com/mac" },
      }),
    ).toEqual({
      store: "download",
      url: "https://example.com/mac",
    });
  });

  it("windows prefers the Microsoft Store, then the download URL", () => {
    expect(resolveStore(env({ os: "windows", ecosystem: null }), apps)?.store).toBe("microsoft");
    expect(
      resolveStore(env({ os: "windows", ecosystem: null }), {
        windows: { downloadUrl: "https://example.com/win" },
      })?.store,
    ).toBe("download");
  });

  it("linux prefers flathub over snap over downloadUrl", () => {
    const linux = (stores: object, downloadUrl?: string) => ({ linux: { stores, downloadUrl } });
    const e = env({ os: "linux", ecosystem: null });
    expect(resolveStore(e, apps)?.store).toBe("flathub");
    expect(
      resolveStore(e, linux({ snap: "https://snapcraft.io/example" }, "https://example.com/linux"))?.store,
    ).toBe("snap");
    expect(resolveStore(e, linux({}, "https://example.com/linux"))?.store).toBe("download");
    expect(resolveStore(e, linux({}))).toBeNull();
  });

  it("chromeos with useAndroidApp resolves google, otherwise null", () => {
    const e = env({ os: "chromeos", ecosystem: null });
    expect(resolveStore(e, apps)).toEqual({ store: "google", url: GOOGLE });
    expect(resolveStore(e, { ...apps, chromeos: { useAndroidApp: false } })).toBeNull();
    expect(resolveStore(e, { ios: apps.ios })).toBeNull();
  });

  it("an unknown OS resolves null", () => {
    expect(resolveStore(env({ os: "unknown", ecosystem: null }), apps)).toBeNull();
  });

  it("store URLs are returned byte-identical", () => {
    const odd = "https://apps.apple.com/app/apple-store/id123456789?pt=123456&ct=Test%20Camp&mt=8";
    expect(resolveStore(env({ os: "ios", ecosystem: null }), { ios: { storeUrl: odd } })?.url).toBe(odd);
  });
});

describe("withPlayReferrer", () => {
  const original = "https://example.com/property/42?a=1&a=2&b=&c=%C3%BC#top";

  it("puts encodeURIComponent(full url) in referrer", () => {
    expect(withPlayReferrer(GOOGLE, original)).toBe(`${GOOGLE}&referrer=${encodeURIComponent(original)}`);
  });

  it("starts the query when the store URL has none", () => {
    expect(withPlayReferrer("https://play.google.com/store/apps/details", original)).toBe(
      `https://play.google.com/store/apps/details?referrer=${encodeURIComponent(original)}`,
    );
  });

  it("inserts the parameter before a fragment", () => {
    expect(withPlayReferrer(`${GOOGLE}#frag`, original)).toBe(
      `${GOOGLE}&referrer=${encodeURIComponent(original)}#frag`,
    );
  });

  it("is omitted when the encoded value exceeds 512 characters, never truncated", () => {
    const long = "https://example.com/p?" + "x=1&".repeat(300);
    expect(encodeURIComponent(long).length).toBeGreaterThan(512);
    expect(withPlayReferrer(GOOGLE, long)).toBe(GOOGLE);
  });

  it("is still added at exactly 512 characters", () => {
    const base = "https://example.com/p?q=";
    const url = base + "a".repeat(512 - encodeURIComponent(base).length);
    expect(encodeURIComponent(url).length).toBe(512);
    expect(withPlayReferrer(GOOGLE, url)).toContain("&referrer=");
  });

  it("keeps an existing referrer untouched", () => {
    const withRef = `${GOOGLE}&referrer=utm_source%3Dnewsletter`;
    expect(withPlayReferrer(withRef, original)).toBe(withRef);
    expect(withPlayReferrer(`${GOOGLE.replace("?id=", "?referrer=x&id=")}`, original)).toContain(
      "referrer=x&id=",
    );
  });
});
