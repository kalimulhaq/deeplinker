import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/parse";
import { toRuntimeConfig } from "../src/config/runtime-config";
import { decide, type DecideContext } from "../src/decide/decide";
import { detect } from "../src/detect/detect";
import type { Env, RuntimeConfig } from "../src/types";

const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
const PLAY = "https://play.google.com/store/apps/details?id=com.example.app";
const GALAXY = "https://galaxystore.samsung.com/detail/com.example.app";
const APPSTORE = "https://apps.apple.com/app/id123456789";

function runtime(input: Record<string, unknown>): RuntimeConfig {
  const r = parseConfig({ domains: ["example.com"], ...input });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return toRuntimeConfig(r.config);
}

const full = runtime({
  paths: ["/property/*", "/listing/*", "!/admin/*"],
  apps: {
    ios: { storeUrl: APPSTORE },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: [FP],
      stores: { samsung: GALAXY, google: PLAY },
    },
    macos: { storeUrl: "https://apps.apple.com/app/id555" },
    windows: { storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1" },
  },
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
});

const env = (over: Partial<Env>): Env => ({
  os: "android",
  deviceClass: "phone",
  browser: "chrome",
  ecosystem: "google",
  inApp: null,
  bot: null,
  ...over,
});
const IOS = env({ os: "ios", browser: "safari", ecosystem: null });
const ANDROID = env({});
const SAMSUNG = env({ ecosystem: "samsung", browser: "samsung" });
const MAC = env({ os: "macos", deviceClass: "desktop", browser: "safari", ecosystem: null });
const WINDOWS = env({ os: "windows", deviceClass: "desktop", ecosystem: null });
const LINUX = env({ os: "linux", deviceClass: "desktop", browser: "firefox", ecosystem: null });

const HREF = "https://example.com/property/42?a=1&a=2&b=#top";

function run(over: Partial<DecideContext> & { env: Env }) {
  return decide({
    href: HREF,
    config: full,
    guardSet: false,
    storageOk: true,
    relatedAppInstalled: undefined,
    ...over,
  });
}

describe("rules A and B: the OS did not open the app, so go to the store", () => {
  it("A2 ios → App Store, URL untouched", () => {
    const d = run({ env: IOS });
    expect(d).toMatchObject({
      action: "redirect",
      reason: "store",
      target: { kind: "store", store: "appstore", url: APPSTORE },
    });
  });

  it("A2 ipados → App Store", () => {
    expect(
      run({ env: env({ os: "ipados", deviceClass: "tablet", browser: "safari", ecosystem: null }) }).target
        ?.store,
    ).toBe("appstore");
  });

  it("A2 android samsung → Galaxy Store, no referrer added", () => {
    const d = run({ env: SAMSUNG });
    expect(d.target).toMatchObject({ kind: "store", store: "samsung", url: GALAXY });
  });

  it("A2 android samsung, with Google Play written first → Google Play", () => {
    const playFirst = runtime({ apps: { android: { stores: { google: PLAY, samsung: GALAXY } } } });
    expect(run({ env: SAMSUNG, config: playFirst }).target?.store).toBe("google");
  });

  it("A2 android google → Play with the full original URL as referrer", () => {
    const d = run({ env: ANDROID });
    expect(d.target).toEqual({
      kind: "store",
      store: "google",
      url: `${PLAY}&referrer=${encodeURIComponent(HREF)}`,
    });
  });

  it("B2 a desktop is never sent to its store: it goes to the web app, with the store still offered", () => {
    // A desktop browser keeps links in the browser even when the app is installed, so the page cannot tell.
    for (const [desktop, store] of [
      [MAC, "macappstore"],
      [WINDOWS, "microsoft"],
    ] as const) {
      const d = run({ env: desktop });
      expect(d).toMatchObject({ action: "redirect", reason: "web", target: { kind: "web" } });
      expect(d.choices.store?.store).toBe(store);
    }
  });

  it("B2 a desktop with a store and no web app stays, with the store as the suggested target", () => {
    const storesOnly = runtime({
      apps: {
        macos: { storeUrl: "https://apps.apple.com/app/id555" },
        windows: { storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1" },
        linux: { downloadUrl: "https://example.com/linux" },
      },
    });
    expect(run({ env: MAC, config: storesOnly })).toMatchObject({
      action: "prompt",
      reason: "desktop-store",
      target: { store: "macappstore", url: "https://apps.apple.com/app/id555" },
    });
    expect(run({ env: WINDOWS, config: storesOnly })).toMatchObject({
      action: "prompt",
      reason: "desktop-store",
      target: { store: "microsoft" },
    });
    expect(run({ env: LINUX, config: storesOnly })).toMatchObject({
      action: "prompt",
      reason: "desktop-store",
      target: { store: "download" },
    });
  });

  it("the store redirect carries redirectDelayMs", () => {
    const delayed = runtime({
      apps: { ios: { storeUrl: APPSTORE } },
      behavior: { redirectDelayMs: 1500 },
    });
    expect(run({ env: IOS, config: delayed }).delayMs).toBe(1500);
  });
});

describe("rule A3 / B3 / C: fall back to the web app, or stay", () => {
  const webOnly = runtime({
    web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
  });

  it("A3 a phone with no mobile app goes to the web app", () => {
    expect(run({ env: IOS, config: webOnly })).toMatchObject({
      action: "redirect",
      reason: "web",
      target: { kind: "web" },
    });
  });

  it("B3 a desktop with no desktop app goes to the web app", () => {
    expect(run({ env: LINUX, config: webOnly })).toMatchObject({ action: "redirect", reason: "web" });
  });

  it("A3 an android phone whose store is not configured goes to the web app", () => {
    const huawei = env({ ecosystem: "huawei" });
    expect(run({ env: huawei }).target?.kind).toBe("web");
  });

  it("C1 keeps the mapped path, every query parameter and the hash byte for byte", () => {
    expect(run({ env: LINUX, config: webOnly }).target?.url).toBe(
      "https://app.example.com/p/42?a=1&a=2&b=#top",
    );
  });

  it("C2 no web app and no store → stay (no redirect, no error)", () => {
    const none = runtime({ paths: ["/property/*"] });
    expect(run({ env: LINUX, config: none })).toMatchObject({ action: "none", reason: "no-target" });
    expect(run({ env: IOS, config: none })).toMatchObject({ action: "none", reason: "no-target" });
  });

  it("a web app on the very URL we are on stays put instead of looping", () => {
    const same = runtime({ web: { url: "https://example.com" } });
    expect(run({ env: LINUX, config: same })).toMatchObject({ action: "none", reason: "no-target" });
    const sameMapped = runtime({
      web: { url: "https://EXAMPLE.com", routes: [{ from: "/property/:id", to: "/property/:id" }] },
    });
    expect(run({ env: LINUX, config: sameMapped }).action).toBe("none");
  });

  it("a web app on the same site under another path still redirects", () => {
    const sub = runtime({ web: { url: "https://example.com/app" } });
    expect(run({ env: LINUX, config: sub }).target?.url).toBe(
      "https://example.com/app/property/42?a=1&a=2&b=#top",
    );
  });
});

describe("the guards come first", () => {
  it("?dl_skip=1 → none", () => {
    expect(run({ env: IOS, href: "https://example.com/property/42?x=1&dl_skip=1" })).toMatchObject({
      action: "none",
      reason: "skip-param",
    });
    expect(run({ env: IOS, href: "https://example.com/property/42?dl_skip" }).reason).toBe("skip-param");
  });

  it("?dl_skip=0 does not skip", () => {
    expect(run({ env: IOS, href: "https://example.com/property/42?dl_skip=0" }).action).toBe("redirect");
  });

  it("the skip parameter name comes from the config", () => {
    const custom = runtime({ apps: { ios: { storeUrl: APPSTORE } }, behavior: { skipParam: "nodl" } });
    expect(run({ env: IOS, config: custom, href: "https://example.com/x?nodl=1" }).reason).toBe("skip-param");
    expect(run({ env: IOS, config: custom, href: "https://example.com/x?dl_skip=1" }).action).toBe(
      "redirect",
    );
  });

  it("a guard set in sessionStorage → none", () => {
    expect(run({ env: IOS, guardSet: true })).toMatchObject({ action: "none", reason: "guard" });
  });

  it("a bot is never redirected, even when it looks like an android phone", () => {
    const googlebot = detect({
      ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    expect(googlebot.os).toBe("android");
    expect(run({ env: googlebot })).toMatchObject({ action: "none", reason: "bot" });
  });

  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "WhatsApp/2.23.20.0 A",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  ])("social crawler %s is never redirected", (ua) => {
    expect(run({ env: detect({ ua }) }).action).toBe("none");
  });

  it("redirectBots: true lets a crawler through", () => {
    const loose = runtime({ apps: { ios: { storeUrl: APPSTORE } }, behavior: { redirectBots: true } });
    expect(run({ env: { ...IOS, bot: "generic" }, config: loose }).action).toBe("redirect");
  });

  it("a path that is not a configured deep link → none", () => {
    expect(run({ env: IOS, href: "https://example.com/about" })).toMatchObject({
      action: "none",
      reason: "not-deep-link-path",
    });
    expect(run({ env: IOS, href: "https://example.com/admin/users" }).reason).toBe("not-deep-link-path");
  });

  it("a generic WebView is left alone: whose app it is cannot be known", () => {
    expect(run({ env: env({ inApp: "webview" }) })).toMatchObject({ action: "none", reason: "webview" });
  });
});

describe("in-app browsers", () => {
  it("on Android, escape offers an https VIEW intent to open the default browser", () => {
    const d = run({ env: env({ inApp: "instagram" }) });
    expect(d).toMatchObject({ action: "escape", reason: "in-app-browser" });
    expect(d.target).toEqual({
      kind: "intent",
      url: "intent://example.com/property/42?a=1&a=2&b=#Intent;scheme=https;action=android.intent.action.VIEW;end",
    });
  });

  it("on iOS, escape has no target: only the page can tell the visitor to open Safari", () => {
    const d = run({ env: { ...IOS, inApp: "facebook" } });
    expect(d).toMatchObject({ action: "escape" });
    expect(d.target).toBeUndefined();
  });

  it("an app that blocks intents (WeChat) gets no target: an intent would not open there", () => {
    const d = run({ env: env({ inApp: "wechat" }) });
    expect(d.action).toBe("escape");
    expect(d.target).toBeUndefined();
  });

  it("with redirectInAppBrowsers on the normal routing continues", () => {
    const off = runtime({ apps: { ios: { storeUrl: APPSTORE } }, behavior: { redirectInAppBrowsers: true } });
    expect(run({ env: { ...IOS, inApp: "instagram" }, config: off }).action).toBe("redirect");
  });
});

describe("step 4: an installed app reported by getInstalledRelatedApps", () => {
  it("is offered in choices and never auto-opened or redirected", () => {
    const d = run({ env: ANDROID, relatedAppInstalled: true });
    expect(d).toMatchObject({ action: "prompt", reason: "related-app-installed" });
    expect(d.choices.open).toMatch(
      /^intent:\/\/example\.com\/property\/42\?a=1&a=2&b=#Intent;scheme=https;package=com\.example\.app;/,
    );
  });

  it("does not offer the store to someone who already has the app", () => {
    expect(run({ env: ANDROID, relatedAppInstalled: true }).choices.store).toBeUndefined();
  });

  it("with no way to open the app there is nothing to show", () => {
    const noPkg = runtime({ apps: { android: { stores: { google: PLAY } } } });
    expect(run({ env: ANDROID, config: noPkg, relatedAppInstalled: true }).action).toBe("none");
  });

  it("false or unknown changes nothing", () => {
    expect(run({ env: IOS, relatedAppInstalled: false }).action).toBe("redirect");
    expect(run({ env: IOS, relatedAppInstalled: undefined }).action).toBe("redirect");
  });
});

describe("step 5: Android Chrome with a scheme gets one more chance to open the app", () => {
  const withScheme = (extra: Record<string, unknown> = {}) =>
    runtime({
      apps: {
        android: {
          packageName: "com.example.app",
          sha256CertFingerprints: [FP],
          scheme: "exampleapp",
          stores: { google: PLAY },
        },
      },
      ...extra,
    });

  it("uses intent:// with the store as the browser fallback", () => {
    const d = run({ env: ANDROID, config: withScheme() });
    const fallback = `${PLAY}&referrer=${encodeURIComponent(HREF)}`;
    expect(d).toMatchObject({ action: "intent", reason: "android-intent" });
    expect(d.target).toEqual({
      kind: "intent",
      url: `intent://example.com/property/42?a=1&a=2&b=#Intent;scheme=exampleapp;package=com.example.app;S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
    });
  });

  it("falls back to the web app when there is no store for this device", () => {
    const cfg = runtime({
      apps: {
        android: {
          packageName: "com.example.app",
          scheme: "exampleapp",
          stores: { huawei: "https://appgallery.huawei.com/app/C1" },
        },
      },
      web: { url: "https://app.example.com" },
    });
    const d = run({ env: ANDROID, config: cfg });
    expect(d.action).toBe("intent");
    // The web app's URL travels inside the intent as the browser fallback, query and hash intact.
    expect(d.target?.url).toContain(
      "S.browser_fallback_url=" + encodeURIComponent("https://app.example.com/property/42?a=1&a=2&b=#top"),
    );
  });

  it("does nothing when neither a store nor a web app could catch the fallback", () => {
    const cfg = runtime({
      apps: {
        android: {
          packageName: "com.example.app",
          scheme: "exampleapp",
          stores: { huawei: "https://appgallery.huawei.com/app/C1" },
        },
      },
    });
    expect(run({ env: ANDROID, config: cfg }).action).toBe("none");
  });

  it("is Chrome only: Firefox goes straight to the store", () => {
    expect(run({ env: env({ browser: "firefox" }), config: withScheme() }).action).toBe("redirect");
  });

  it("is never used without a scheme", () => {
    expect(run({ env: ANDROID, config: full }).action).toBe("redirect");
  });
});

describe("step 8: redirect off", () => {
  const stay = runtime({
    apps: {
      android: { packageName: "com.example.app", scheme: "exampleapp", stores: { google: PLAY } },
      ios: { storeUrl: APPSTORE },
    },
    web: { url: "https://app.example.com" },
    behavior: { redirect: false },
  });

  it("offers every choice, names the target it would have used, and never redirects", () => {
    const d = run({ env: ANDROID, config: stay });
    expect(d).toMatchObject({ action: "prompt", reason: "redirect-off" });
    expect(d.choices.store?.store).toBe("google");
    expect(d.choices.web?.kind).toBe("web");
    expect(d.choices.open).toContain("intent://example.com/property/42");
    expect(d.target).toEqual(d.choices.store);
  });

  it("never produces intent:// on its own", () => {
    expect(run({ env: ANDROID, config: stay }).action).not.toBe("intent");
  });

  it("with nothing to offer it stays out of the way", () => {
    const empty = runtime({ behavior: { redirect: false } });
    expect(run({ env: IOS, config: empty }).action).toBe("none");
  });

  it("the guards still come first", () => {
    expect(run({ env: IOS, config: stay, guardSet: true }).reason).toBe("guard");
    expect(run({ env: { ...IOS, inApp: "instagram" }, config: stay }).action).toBe("escape");
  });
});

describe("storage unavailable (private mode, blocked storage)", () => {
  const web = runtime({ web: { url: "https://example.com/app" } });

  it("appends the skip parameter last when the web target is on the same site", () => {
    const d = run({ env: LINUX, config: web, storageOk: false });
    expect(d.target?.url).toBe("https://example.com/app/property/42?a=1&a=2&b=&dl_skip=1#top");
  });

  it("starts a query when there is none", () => {
    const d = run({ env: LINUX, config: web, storageOk: false, href: "https://example.com/property/42#top" });
    expect(d.target?.url).toBe("https://example.com/app/property/42?dl_skip=1#top");
  });

  it("leaves a different site alone", () => {
    const other = runtime({ web: { url: "https://app.other.com" } });
    expect(run({ env: LINUX, config: other, storageOk: false }).target?.url).toBe(
      "https://app.other.com/property/42?a=1&a=2&b=#top",
    );
  });

  it("leaves store URLs alone", () => {
    expect(run({ env: IOS, storageOk: false }).target?.url).toBe(APPSTORE);
  });

  it("changes nothing when storage works", () => {
    expect(run({ env: LINUX, config: web, storageOk: true }).target?.url).not.toContain("dl_skip");
  });
});

describe("what the browser can and cannot do about links", () => {
  it("Windows browsers do not hand links to the app, and the decision says so", () => {
    expect(run({ env: WINDOWS }).linkHandling).toBe("none");
  });

  it("Linux has no verified link mechanism, and the page does not open custom schemes", () => {
    const linux = runtime({
      apps: { linux: { scheme: "exampleapp", downloadUrl: "https://example.com/linux" } },
    });
    const d = run({ env: LINUX, config: linux });
    expect(d.linkHandling).toBe("none");
    expect(d.choices.open).toBeUndefined();
    expect(d).toMatchObject({ action: "prompt", reason: "desktop-store" });
    expect(d.target?.url).toBe("https://example.com/linux");
  });

  it("macOS outside Safari does not open Universal Links, Safari mostly does", () => {
    expect(run({ env: { ...MAC, browser: "chrome" } }).linkHandling).toBe("none");
    expect(run({ env: MAC }).linkHandling).toBe("partial");
  });

  it("Android Chrome hands links to the OS; Firefox and iOS only sometimes", () => {
    expect(run({ env: ANDROID }).linkHandling).toBe("os");
    expect(run({ env: env({ browser: "firefox" }) }).linkHandling).toBe("partial");
    expect(run({ env: IOS }).linkHandling).toBe("partial");
  });

  it("a none decision still reports link handling", () => {
    expect(run({ env: WINDOWS, guardSet: true }).linkHandling).toBe("none");
  });
});

describe("decide: routing rules decide where the web app link goes", () => {
  const app = runtime({
    apps: { ios: { storeUrl: APPSTORE } },
    web: {
      url: "https://app.example.com",
      routes: [
        { from: "/app?lead=:id", to: "/applicants#:id" },
        { from: "/app?owner_lead=:id", to: "/properties/:id" },
        { from: "/app", to: null },
      ],
    },
  });
  const visit = (href: string, e: Env) =>
    decide({ href, config: app, guardSet: false, storageOk: true, relatedAppInstalled: undefined, env: e });

  it("a desktop visitor goes to the target the parameter names, without the rest of the query", () => {
    const d = visit("https://example.com/app?lead=abc&token=secret#frag", WINDOWS);
    expect(d).toMatchObject({
      action: "redirect",
      reason: "web",
      target: { kind: "web", url: "https://app.example.com/applicants#abc" },
    });
  });

  it("a desktop visitor with nothing to map stays: there is no web equivalent", () => {
    expect(visit("https://example.com/app", WINDOWS)).toMatchObject({ action: "none", reason: "no-target" });
    expect(visit("https://example.com/app?token=x", MAC)).toMatchObject({
      action: "none",
      reason: "no-target",
    });
  });

  it("a phone still goes to its store, and the web target is only the fallback", () => {
    const d = visit("https://example.com/app?lead=abc", IOS);
    expect(d).toMatchObject({ action: "redirect", reason: "store", target: { url: APPSTORE } });
    expect(d.choices.web?.url).toBe("https://app.example.com/applicants#abc");
  });
});
