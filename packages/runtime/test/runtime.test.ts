import { parseConfig, toRuntimeConfig, type RuntimeConfig } from "@deeplinker/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
const PLAY = "https://play.google.com/store/apps/details?id=com.example.app";
const APPSTORE = "https://apps.apple.com/app/id123456789";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Instagram 340.0.0.30.109 Android",
  linuxFirefox: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  googlebot:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

function config(input: Record<string, unknown>): RuntimeConfig {
  const parsed = parseConfig({ domains: ["example.com"], ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return toRuntimeConfig(parsed.config);
}

const base = {
  paths: ["/property/*"],
  apps: {
    ios: { storeUrl: APPSTORE },
    android: { packageName: "com.example.app", sha256CertFingerprints: [FP], stores: { google: PLAY } },
  },
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
};

/** A fresh copy of the runtime: it keeps its state (config, handlers, "already started") at module level. */
async function load() {
  vi.resetModules();
  return import("../src/index");
}

/** Fakes the page: URL, user agent, and a location whose navigation we can observe. */
function page(href: string, ua: string, extra: Record<string, unknown> = {}) {
  const replace = vi.fn();
  const location = { href, replace } as { href: string; replace: typeof replace };
  vi.stubGlobal("location", location);
  vi.stubGlobal("navigator", { userAgent: ua, platform: "", maxTouchPoints: 0, language: "en-US", ...extra });
  return { replace, location };
}

const HREF = "https://example.com/property/42?a=1&a=2&b=#top";

beforeEach(() => {
  sessionStorage.clear();
  document.head.querySelectorAll('meta[name="apple-itunes-app"]').forEach((n) => n.remove());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The whole document, to show that nothing on the page was added or changed. */
const pageHtml = () => document.documentElement.outerHTML;

describe("routing effects", () => {
  it("redirects an iPhone to the App Store with location.replace", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    const decision = await open();
    expect(decision).toMatchObject({ action: "redirect", reason: "store" });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(APPSTORE);
  });

  it("sends Android Chrome to Play with the full original URL as the referrer", async () => {
    const { replace } = page(HREF, UA.androidChrome);
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect(replace).toHaveBeenCalledWith(`${PLAY}&referrer=${encodeURIComponent(HREF)}`);
  });

  it("falls back to the web app and keeps the mapped path, query and hash byte for byte", async () => {
    const { replace } = page(HREF, UA.linuxFirefox);
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect(replace).toHaveBeenCalledWith("https://app.example.com/p/42?a=1&a=2&b=#top");
  });

  it("stays when there is nowhere to go (rule C2)", async () => {
    const { replace } = page(HREF, UA.linuxFirefox);
    const { init, open, on } = await load();
    const stays: unknown[] = [];
    on("stay", (d) => stays.push(d));
    init(config({ paths: ["/property/*"] }), { run: false });
    expect(await open()).toMatchObject({ action: "none", reason: "no-target" });
    expect(replace).not.toHaveBeenCalled();
    expect(stays).toEqual([{ reason: "no-target" }]);
  });

  it("stays on a path that is not a deep link", async () => {
    const { replace } = page("https://example.com/about", UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    expect(await open()).toMatchObject({ action: "none", reason: "not-deep-link-path" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("?dl_skip=1 stays, and keeps staying on the next page of the session", async () => {
    const { replace, location } = page("https://example.com/property/42?a=1&dl_skip=1#top", UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    expect((await open()).reason).toBe("skip-param");
    location.href = "https://example.com/property/43";
    expect((await open()).reason).toBe("guard");
    expect(replace).not.toHaveBeenCalled();
  });

  it("never redirects a crawler that looks like a phone", async () => {
    const { replace } = page(HREF, UA.googlebot);
    const { init, open } = await load();
    init(config(base), { run: false });
    expect(await open()).toMatchObject({ action: "none", reason: "bot" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("Android Chrome with a scheme navigates to intent:// with the store as the fallback", async () => {
    const { replace, location } = page(HREF, UA.androidChrome);
    const { init, open } = await load();
    const withScheme = {
      ...base,
      apps: { ...base.apps, android: { ...base.apps.android, scheme: "exampleapp" } },
    };
    init(config(withScheme), { run: false });
    expect(await open()).toMatchObject({ action: "intent" });
    expect(
      location.href.startsWith("intent://example.com/property/42?a=1&a=2&b=#Intent;scheme=exampleapp;"),
    ).toBe(true);
    expect(location.href).toContain("S.browser_fallback_url=");
    expect(replace).not.toHaveBeenCalled();
  });

  it("uses the model Client Hint to pick the Samsung store when Chrome hides the model", async () => {
    const galaxy = "https://galaxystore.samsung.com/detail/com.example.app";
    const { replace } = page(HREF, UA.androidChrome, {
      userAgentData: {
        mobile: true,
        platform: "Android",
        getHighEntropyValues: async () => ({ model: "SM-S918B" }),
      },
    });
    const { init, open } = await load();
    const cfg = config({
      ...base,
      apps: { android: { ...base.apps.android, stores: { samsung: galaxy, google: PLAY } } },
    });
    init(cfg, { run: false });
    await open();
    expect(replace).toHaveBeenCalledWith(galaxy);
  });

  it("does not wait on a Client Hints call that never answers", async () => {
    vi.useFakeTimers();
    const { replace } = page(HREF, UA.androidChrome, {
      userAgentData: { mobile: true, platform: "Android", getHighEntropyValues: () => new Promise(() => {}) },
    });
    const { init, open } = await load();
    init(config(base), { run: false });
    const done = open();
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("autoruns from init() unless run is false", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init } = await load();
    init(config(base));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(APPSTORE));
  });
});

describe("the loop guard", () => {
  it("is set in sessionStorage before the navigation happens", async () => {
    const { replace } = page(HREF, UA.iphone);
    let guardAtNavigation: string | null = null;
    replace.mockImplementation(() => {
      guardAtNavigation = sessionStorage.getItem("deeplinker:guard");
    });
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect(guardAtNavigation).toBe("1");
  });

  it("stops a second run in the same tab", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect((await open()).reason).toBe("guard");
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("survives a reload: a fresh copy of the runtime sees the guard in sessionStorage", async () => {
    const { replace } = page(HREF, UA.iphone);
    const first = await load();
    first.init(config(base), { run: false });
    await first.open();
    const second = await load();
    second.init(config(base), { run: false });
    expect((await second.open()).reason).toBe("guard");
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory when sessionStorage throws, and still does not loop", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const { replace } = page(HREF, UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect((await open()).reason).toBe("guard");
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("with storage blocked, a same-site web target carries the skip parameter so the next page cannot loop either", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const { replace } = page(HREF, UA.linuxFirefox);
    const { init, open } = await load();
    init(config({ paths: ["/property/*"], web: { url: "https://example.com/app" } }), {
      run: false,
    });
    await open();
    expect(replace).toHaveBeenCalledWith("https://example.com/app/property/42?a=1&a=2&b=&dl_skip=1#top");
  });
});

describe("public API and events", () => {
  it("emits detect, decision and redirect in that order, and as CustomEvents on window", async () => {
    page(HREF, UA.iphone);
    const { init, open, on } = await load();
    const order: string[] = [];
    (["detect", "decision", "redirect"] as const).forEach((name) => on(name, () => order.push(name)));
    const dom: string[] = [];
    (["detect", "decision", "redirect"] as const).forEach((name) =>
      window.addEventListener("deeplinker:" + name, (e) =>
        dom.push(name + ":" + typeof (e as CustomEvent).detail),
      ),
    );
    init(config(base), { run: false });
    await open();
    expect(order).toEqual(["detect", "decision", "redirect"]);
    expect(dom).toEqual(["detect:object", "decision:object", "redirect:object"]);
  });

  it("on() returns a function that unsubscribes", async () => {
    page(HREF, UA.iphone);
    const { init, open, on } = await load();
    const seen: string[] = [];
    const off = on("detect", () => seen.push("x"));
    off();
    init(config(base), { run: false });
    await open();
    expect(seen).toEqual([]);
  });

  it("a handler that throws does not stop the others or the redirect", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init, open, on } = await load();
    const seen: string[] = [];
    on("decision", () => {
      throw new Error("boom");
    });
    on("decision", () => seen.push("second"));
    init(config(base), { run: false });
    await open();
    expect(seen).toEqual(["second"]);
    expect(replace).toHaveBeenCalled();
  });

  it("resolve() returns the decision and acts on nothing", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init, resolve } = await load();
    init(config(base), { run: false });
    const decision = await resolve();
    expect(decision).toMatchObject({ action: "redirect", target: { url: APPSTORE } });
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("deeplinker:guard")).toBeNull();
  });

  it("open() runs the decision", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("only the first init() counts", async () => {
    const { replace } = page(HREF, UA.iphone);
    const { init, open } = await load();
    init(config(base), { run: false });
    init(config({ ...base, apps: { ios: { storeUrl: "https://apps.apple.com/app/id999" } } }), {
      run: false,
    });
    await open();
    expect(replace).toHaveBeenCalledWith(APPSTORE);
  });

  it("is quiet unless debug is on, and logs every event when it is", async () => {
    page(HREF, UA.iphone);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const quiet = await load();
    quiet.init(config(base), { run: false });
    await quiet.open();
    expect(log).not.toHaveBeenCalled();

    sessionStorage.clear();
    const loud = await load();
    loud.init(config({ ...base, debug: true }), { run: false });
    await loud.open();
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.every((c) => c[0] === "[deeplinker]")).toBe(true);
  });
});

describe("never throws to the host page", () => {
  it("init() without a config reports an error event instead of throwing", async () => {
    page(HREF, UA.iphone);
    const { init, on } = await load();
    const errors: unknown[] = [];
    on("error", (e) => errors.push(e));
    expect(() => init()).not.toThrow();
    expect(() => init("nope" as never)).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("resolve() and open() before init() resolve to an error decision", async () => {
    page(HREF, UA.iphone);
    const { resolve, open } = await load();
    expect(await resolve()).toMatchObject({ action: "none", reason: "error" });
    expect(await open()).toMatchObject({ action: "none", reason: "error" });
  });

  it("survives a navigator and a location that throw", async () => {
    vi.stubGlobal("navigator", {
      get userAgent(): string {
        throw new Error("no ua");
      },
    });
    vi.stubGlobal("location", {
      get href(): string {
        throw new Error("no href");
      },
    });
    const { init, open } = await load();
    expect(() => init(config(base), { run: false })).not.toThrow();
    await expect(open()).resolves.toMatchObject({ action: "none", reason: "error" });
  });

  it("survives a failing location.replace", async () => {
    const { replace } = page(HREF, UA.iphone);
    replace.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { init, open } = await load();
    init(config(base), { run: false });
    await expect(open()).resolves.toBeDefined();
  });
});

describe("the page is left exactly as it is", () => {
  it("redirect: false stays, announces every choice, and adds nothing to the page", async () => {
    const { replace } = page(HREF, UA.androidChrome);
    const { init, open, on } = await load();
    const stays: unknown[] = [];
    on("stay", (d) => stays.push(d));
    const before = pageHtml();
    init(config({ ...base, behavior: { redirect: false } }), { run: false });
    const d = await open();
    expect(d).toMatchObject({ action: "prompt", reason: "redirect-off" });
    expect(Object.keys(d.choices).sort()).toEqual(["open", "store", "web"]);
    expect(replace).not.toHaveBeenCalled();
    expect(stays).toEqual([{ reason: "redirect-off" }]);
    expect(pageHtml()).toBe(before);
  });

  it("a desktop with a store and no web app stays, with the store in choices", async () => {
    const { replace } = page(HREF, UA.linuxFirefox);
    const { init, open } = await load();
    init(config({ paths: ["/property/*"], apps: { linux: { downloadUrl: "https://example.com/linux" } } }), {
      run: false,
    });
    const d = await open();
    expect(d).toMatchObject({ action: "prompt", reason: "desktop-store" });
    expect(d.choices.store?.url).toBe("https://example.com/linux");
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves a Smart App Banner tag exactly as the site wrote it", async () => {
    page("https://example.com/property/42?ids=1,2,3", UA.iphone);
    const meta = document.createElement("meta");
    meta.setAttribute("name", "apple-itunes-app");
    meta.setAttribute("content", "app-id=123456789");
    document.head.appendChild(meta);
    const { init, open } = await load();
    init(config(base), { run: false });
    await open();
    expect(meta.getAttribute("content")).toBe("app-id=123456789");
  });
});

describe("in-app browsers", () => {
  it("Android: an https VIEW intent in the decision for the page to offer, no redirect, nothing drawn", async () => {
    const { replace } = page(HREF, UA.instagramAndroid);
    const { init, open } = await load();
    const before = pageHtml();
    init(config(base), { run: false });
    const d = await open();
    expect(d).toMatchObject({ action: "escape", reason: "in-app-browser" });
    expect(d.target?.url).toBe(
      "intent://example.com/property/42?a=1&a=2&b=#Intent;scheme=https;action=android.intent.action.VIEW;end",
    );
    expect(replace).not.toHaveBeenCalled();
    expect(pageHtml()).toBe(before);
  });

  it("iOS: no target, because only the visitor can open Safari", async () => {
    const instagramIos =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.19.108";
    const { replace } = page(HREF, instagramIos);
    const { init, open } = await load();
    init(config(base), { run: false });
    const d = await open();
    expect(d).toMatchObject({ action: "escape" });
    expect(d.target).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirectInAppBrowsers: true routes them like any other browser", async () => {
    const { replace } = page(HREF, UA.instagramAndroid.replace("; wv)", ")"));
    const { init, open } = await load();
    init(config({ ...base, behavior: { redirectInAppBrowsers: true } }), { run: false });
    await open();
    expect(replace).toHaveBeenCalled();
  });
});

describe("installed app and redirect delay", () => {
  it("getInstalledRelatedApps reporting an app stays and offers the app link instead of redirecting", async () => {
    const { replace } = page(HREF, UA.androidChrome, {
      getInstalledRelatedApps: async () => [{ platform: "play" }],
    });
    const { init, open } = await load();
    init(config(base), { run: false });
    const d = await open();
    expect(d).toMatchObject({ action: "prompt", reason: "related-app-installed" });
    expect(d.choices.open).toMatch(/^intent:\/\//);
    expect(replace).not.toHaveBeenCalled();
  });

  it("an API that returns nothing, throws or never answers does not block the redirect", async () => {
    for (const getInstalledRelatedApps of [async () => [], async () => Promise.reject(new Error("no"))]) {
      sessionStorage.clear();
      const { replace } = page(HREF, UA.androidChrome, { getInstalledRelatedApps });
      const { init, open } = await load();
      init(config(base), { run: false });
      await open();
      expect(replace).toHaveBeenCalledTimes(1);
    }
  });

  it("a redirect delay waits, then redirects, drawing nothing in between", async () => {
    vi.useFakeTimers();
    const { replace } = page(HREF, UA.androidChrome);
    const { init, open } = await load();
    const before = pageHtml();
    init(config({ ...base, behavior: { redirectDelayMs: 1500 } }), { run: false });
    await open();
    expect(replace).not.toHaveBeenCalled();
    expect(pageHtml()).toBe(before);
    await vi.advanceTimersByTimeAsync(1500);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("deferred deep linking: telling your endpoint about a click that reaches a store", () => {
  const deferred = (extra: Record<string, unknown> = {}) => ({
    ...base,
    deferred: { enabled: true, ...extra },
  });
  const BEACON = JSON.stringify({ url: HREF });

  it("sends the page URL, byte for byte, just before an automatic store redirect", async () => {
    const sendBeacon = vi.fn(() => true);
    const { replace } = page(HREF, UA.iphone, { sendBeacon });
    const { init, open } = await load();
    init(config(deferred()), { run: false });
    await open();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith("/dl/click", BEACON);
    expect(replace).toHaveBeenCalledWith(APPSTORE);
    expect(sendBeacon.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0] as number,
    );
  });

  it("uses the configured base path", async () => {
    const sendBeacon = vi.fn(() => true);
    page(HREF, UA.iphone, { sendBeacon });
    const { init, open } = await load();
    init(config(deferred({ basePath: "/api/links" })), { run: false });
    await open();
    expect(sendBeacon).toHaveBeenCalledWith("/api/links/click", BEACON);
  });

  it("sends nothing when deferred is off, for a web redirect, for a skipped page or for a crawler", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [base, UA.iphone],
      [
        { ...deferred(), apps: { android: base.apps.android } }, // an iPhone with no iOS app goes to the web app
        UA.iphone,
      ],
      [deferred(), UA.googlebot],
    ];
    for (const [cfg, ua] of cases) {
      sessionStorage.clear();
      const sendBeacon = vi.fn(() => true);
      page(HREF, ua, { sendBeacon });
      const { init, open } = await load();
      init(config(cfg), { run: false });
      await open();
      expect(sendBeacon).not.toHaveBeenCalled();
    }
    sessionStorage.clear();
    const sendBeacon = vi.fn(() => true);
    page("https://example.com/property/42?dl_skip=1#top", UA.iphone, { sendBeacon });
    const { init, open } = await load();
    init(config(deferred()), { run: false });
    await open();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("a missing or failing sendBeacon never stops the redirect", async () => {
    for (const extra of [
      {},
      {
        sendBeacon: () => {
          throw new Error("blocked");
        },
      },
    ]) {
      sessionStorage.clear();
      const { replace } = page(HREF, UA.iphone, extra);
      const { init, open } = await load();
      init(config(deferred()), { run: false });
      await open();
      expect(replace).toHaveBeenCalledWith(APPSTORE);
    }
  });

  describe("when the page stays and offers the store itself", () => {
    const staying = (extra: Record<string, unknown> = {}) =>
      config({ ...deferred(extra), behavior: { redirect: false } });

    /** A link already on the page, like a store badge. Navigation is cancelled so the test page stays put. */
    function link(href: string): HTMLAnchorElement {
      const a = document.createElement("a");
      a.href = href;
      a.innerHTML = "<span>badge</span>";
      a.addEventListener("click", (e) => e.preventDefault());
      document.body.appendChild(a);
      return a;
    }

    afterEach(() => document.body.replaceChildren());

    it("a tap on a link to a configured store is reported once, and the click goes ahead untouched", async () => {
      const sendBeacon = vi.fn(() => true);
      page(HREF, UA.iphone, { sendBeacon });
      const { init, open } = await load();
      const badge = link(APPSTORE);
      const before = document.body.innerHTML;
      init(staying(), { run: false });
      expect(await open()).toMatchObject({ action: "prompt" });
      expect(sendBeacon).not.toHaveBeenCalled();
      (badge.firstChild as HTMLElement).click(); // a tap on what is inside the link counts too
      badge.click();
      expect(sendBeacon).toHaveBeenCalledTimes(1);
      expect(sendBeacon).toHaveBeenCalledWith("/dl/click", BEACON);
      expect(sessionStorage.getItem("deeplinker:guard")).toBe("1");
      expect(document.body.innerHTML).toBe(before);
    });

    it("recognises the Play link as written in the config, without the referrer", async () => {
      const sendBeacon = vi.fn(() => true);
      page(HREF, UA.androidChrome, { sendBeacon });
      const { init, open } = await load();
      const badge = link(PLAY);
      init(staying(), { run: false });
      await open();
      badge.click();
      expect(sendBeacon).toHaveBeenCalledTimes(1);
    });

    it("ignores other links, and does not listen when deferred is off or the page is not a deep link", async () => {
      const sendBeacon = vi.fn(() => true);
      page(HREF, UA.iphone, { sendBeacon });
      let api = await load();
      api.init(staying(), { run: false });
      await api.open();
      link("https://example.com/about").click();
      expect(sendBeacon).not.toHaveBeenCalled();

      for (const [href, cfg] of [
        ["https://example.com/property/7", config({ ...base, behavior: { redirect: false } })],
        ["https://example.com/about", staying()],
      ] as const) {
        document.body.replaceChildren();
        sessionStorage.clear();
        page(href, UA.iphone, { sendBeacon });
        api = await load();
        api.init(cfg, { run: false });
        await api.open();
        link(APPSTORE).click();
      }
      expect(sendBeacon).not.toHaveBeenCalled();
    });

    it("stops listening once a single-page app has moved on to another page", async () => {
      const sendBeacon = vi.fn(() => true);
      const { location } = page("https://example.com/property/8", UA.iphone, { sendBeacon });
      const { init, open } = await load();
      init(staying(), { run: false });
      await open();
      location.href = "https://example.com/pricing"; // client-side navigation to another page
      link(APPSTORE).click();
      expect(sendBeacon).not.toHaveBeenCalled();
    });

    it("go(choices.store) sets the guard, reports the click and navigates, keeping the page in history", async () => {
      const sendBeacon = vi.fn(() => true);
      const { replace, location } = page(HREF, UA.androidChrome, { sendBeacon });
      const { init, open, go, on } = await load();
      const redirects: unknown[] = [];
      on("redirect", (r) => redirects.push(r));
      init(staying(), { run: false });
      const d = await open();
      go(d.choices.store as never);
      expect(sendBeacon).toHaveBeenCalledWith("/dl/click", BEACON);
      expect(location.href).toBe(`${PLAY}&referrer=${encodeURIComponent(HREF)}`); // the referrer makes the match exact
      expect(replace).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("deeplinker:guard")).toBe("1");
      expect(redirects).toHaveLength(1);
    });

    it("go() to the web app or the app link reports nothing", async () => {
      const sendBeacon = vi.fn(() => true);
      const { location } = page(HREF, UA.androidChrome, { sendBeacon });
      const { init, open, go } = await load();
      init(
        config({
          ...deferred(),
          apps: { ...base.apps, android: { ...base.apps.android, scheme: "exampleapp" } },
          behavior: { redirect: false },
        }),
        { run: false },
      );
      const d = await open();
      go(d.choices.web as never);
      expect(location.href).toBe("https://app.example.com/p/42?a=1&a=2&b=#top");
      go(d.choices.open as string);
      expect(location.href).toMatch(/^intent:\/\/example\.com\/property\/42/);
      expect(sendBeacon).not.toHaveBeenCalled();
    });

    it("go() before init() reports an error instead of throwing", async () => {
      page(HREF, UA.iphone);
      const { go, on } = await load();
      const errors: unknown[] = [];
      on("error", (e) => errors.push(e));
      expect(() => go(APPSTORE)).not.toThrow();
      expect(errors).toHaveLength(1);
    });
  });
});

describe("routing rules: where the web app link goes", () => {
  const rules = {
    ...base,
    paths: ["/app", "/property/*"],
    web: {
      url: "https://app.example.com",
      routes: [
        { from: "/app?lead=:id", to: "/applicants#:id" },
        { from: "/app?owner_lead=:id", to: "/properties/:id" },
        { from: "/property/:propertyId/leads?id=:leadId", to: "/property/leads?lead=:leadId&p=:propertyId" },
        { from: "/app", to: null },
      ],
    },
  };

  it("a desktop visitor goes where the parameter says, and the token stays behind", async () => {
    const { replace } = page("https://example.com/app?lead=abc123&token=secret#frag", UA.linuxFirefox);
    const { init, open } = await load();
    init(config(rules), { run: false });
    await open();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("https://app.example.com/applicants#abc123");
  });

  it("moves a path segment and a query value into a new query", async () => {
    const { replace } = page("https://example.com/property/42/leads?id=abc&x=1", UA.linuxFirefox);
    const { init, open } = await load();
    init(config(rules), { run: false });
    await open();
    expect(replace).toHaveBeenCalledWith("https://app.example.com/property/leads?lead=abc&p=42");
  });

  it("a desktop visitor with nothing to map stays on the page", async () => {
    const { replace } = page("https://example.com/app", UA.linuxFirefox);
    const { init, open } = await load();
    init(config(rules), { run: false });
    expect(await open()).toMatchObject({ action: "none", reason: "no-target" });
    expect(replace).not.toHaveBeenCalled();
  });
});
