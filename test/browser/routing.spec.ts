import { expect, test, type Page } from "@playwright/test";
import { APPSTORE, GALAXY, UA, baseConfig, pageMarkup, visit, type Visit } from "./harness";

const PAGE = "https://example.com/property/42?a=1&a=2&b=&c#top";

test.describe("redirects, per rule", () => {
  test("A2: an iPhone goes to the App Store", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.iphone, config: baseConfig });
    await v.page.goto(PAGE);
    await v.page.waitForURL(APPSTORE);
    await v.close();
  });

  test("A2: Android Chrome goes to Google Play with the whole original URL as the referrer", async ({
    browser,
  }) => {
    const v = await visit(browser, { userAgent: UA.androidChrome, config: baseConfig });
    await v.page.goto(PAGE);
    await v.page.waitForURL(/^https:\/\/play\.google\.com\//);
    const url = new URL(v.page.url());
    expect(url.searchParams.get("id")).toBe("com.example.app");
    expect(url.searchParams.get("referrer")).toBe(PAGE);
    await v.close();
  });

  test("A2: Samsung Internet goes to the Galaxy Store", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.samsungInternet, config: baseConfig });
    await v.page.goto(PAGE);
    await v.page.waitForURL(GALAXY);
    await v.close();
  });

  test("B2: desktop Windows goes to the web app, never to its store or download page", async ({
    browser,
  }) => {
    const v = await visit(browser, { userAgent: UA.windowsChrome, config: baseConfig });
    await v.page.goto(PAGE);
    await v.page.waitForURL("https://app.example.com/p/42?a=1&a=2&b=&c#top");
    await v.close();
  });

  test("B2: desktop Windows with no web app stays, with the download offered in the decision", async ({
    browser,
  }) => {
    const { web: _web, ...noWeb } = baseConfig;
    const v = await visit(browser, { userAgent: UA.windowsChrome, config: noWeb });
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    const d = (await v.events()).find((e) => e.name === "decision")?.detail;
    expect(d).toMatchObject({
      action: "prompt",
      reason: "desktop-store",
      target: { url: "https://example.com/download/windows" },
    });
    expect(v.page.url()).toBe(PAGE);
    await v.close();
  });

  test("B3 and C1: no desktop app means the web app, with path mapping, query and hash byte for byte", async ({
    browser,
  }) => {
    const v = await visit(browser, { userAgent: UA.linuxFirefox, config: baseConfig });
    await v.page.goto(PAGE);
    await v.page.waitForURL(/^https:\/\/app\.example\.com\//);
    expect(v.page.url()).toBe("https://app.example.com/p/42?a=1&a=2&b=&c#top");
    await v.close();
  });

  test("C2: no web app and no store means the page stays, and says so", async ({ browser }) => {
    const v = await visit(browser, {
      userAgent: UA.linuxFirefox,
      config: { domains: ["example.com"], paths: ["/property/*"] },
    });
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect(v.page.url()).toBe(PAGE);
    await v.close();
  });
});

test.describe("when it must not redirect", () => {
  test("a path that is not a deep link stays", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.iphone, config: baseConfig });
    await v.page.goto("https://example.com/about");
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect(v.page.url()).toBe("https://example.com/about");
    await v.close();
  });

  test("an excluded path stays", async ({ browser }) => {
    const v = await visit(browser, {
      userAgent: UA.iphone,
      config: { ...baseConfig, paths: ["/*", "!/admin/*"] },
    });
    await v.page.goto("https://example.com/admin/users");
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect(v.page.url()).toBe("https://example.com/admin/users");
    await v.close();
  });

  test("?dl_skip=1 stays", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.iphone, config: baseConfig });
    await v.page.goto("https://example.com/property/42?dl_skip=1");
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect(v.page.url()).toContain("example.com/property/42");
    await v.close();
  });

  test("a crawler that looks like a phone stays", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.googlebot, config: baseConfig });
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect(v.page.url()).toBe(PAGE);
    await v.close();
  });

  test("the loop guard stops a second redirect in the same tab, and a same-site web app cannot loop", async ({
    browser,
  }) => {
    const config = {
      domains: ["example.com"],
      paths: ["/property/*"],
      web: { url: "https://example.com/app" },
    };
    const v = await visit(browser, { userAgent: UA.linuxFirefox, config });
    await v.page.goto("https://example.com/property/42?x=1");
    await v.page.waitForURL("https://example.com/app/property/42?x=1");
    await v.page.waitForTimeout(400);
    expect(v.page.url()).toBe("https://example.com/app/property/42?x=1");
    expect(await v.page.evaluate(() => sessionStorage.getItem("deeplinker:guard"))).toBe("1");
    await v.close();
  });
});

test.describe("the page is left exactly as it is", () => {
  const stay = { ...baseConfig, behavior: { redirect: false } };
  const SERVED = {
    head: ['<meta charset="utf-8">', "<title>page</title>", '<script src="/deeplinker.js"></script>'],
    body: "<h1>page /property/42</h1>",
  };
  const decision = async (v: Visit) =>
    (await v.events()).find((e) => e.name === "decision")?.detail as
      | { action: string; reason: string; target?: { url: string }; choices: Record<string, unknown> }
      | undefined;

  test("redirect: false stays, announces the choices, and adds nothing to the page", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.androidChrome, config: stay });
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    const d = await decision(v);
    expect(d).toMatchObject({ action: "prompt", reason: "redirect-off" });
    expect(Object.keys(d?.choices ?? {}).sort()).toEqual(["open", "store", "web"]);
    expect(await pageMarkup(v.page)).toEqual(SERVED);
    expect(v.page.url()).toBe(PAGE);
    await v.close();
  });

  test("an in-app browser stays, with the way out in the decision and nothing drawn", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.instagramAndroid, config: baseConfig });
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    const d = await decision(v);
    expect(d).toMatchObject({ action: "escape", reason: "in-app-browser" });
    expect(d?.target?.url).toMatch(
      /^intent:\/\/example\.com\/property\/42\?a=1&a=2&b=&c#Intent;scheme=https;action=android\.intent\.action\.VIEW;end$/,
    );
    expect(await pageMarkup(v.page)).toEqual(SERVED);
    expect(v.page.url()).toBe(PAGE);
    await v.close();
  });

  test("a Smart App Banner tag stays exactly as the site wrote it", async ({ browser }) => {
    const tag = '<meta name="apple-itunes-app" content="app-id=123456789">';
    const v = await visit(browser, { userAgent: UA.iphone, config: stay, pageHead: tag });
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect((await pageMarkup(v.page)).head).toEqual([SERVED.head[0], SERVED.head[1], tag, SERVED.head[2]]);
    await v.close();
  });
});

test.describe("deferred deep linking", () => {
  const withDeferred = { ...baseConfig, deferred: { enabled: true } };

  /**
   * Records every `navigator.sendBeacon` call the page makes, then lets it through. The recording goes through an
   * exposed function because the page is about to navigate away to the store, taking its own window with it.
   */
  async function recordBeacons(page: Page) {
    const calls: [string, string][] = [];
    await page.exposeFunction("__recordBeacon", (url: string, data: string) => void calls.push([url, data]));
    await page.addInitScript(() => {
      const w = window as unknown as { __recordBeacon: (url: string, data: string) => void };
      const original = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        w.__recordBeacon(String(url), String(data));
        return original(url, data);
      };
    });
    return calls;
  }

  test("an automatic store redirect reports the page URL first, byte for byte", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.iphone, config: withDeferred });
    const calls = await recordBeacons(v.page);
    await v.page.goto(PAGE);
    await v.page.waitForURL(APPSTORE);
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual(["/dl/click", JSON.stringify({ url: PAGE })]);
    await v.close();
  });

  test("nothing is reported when it is off", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.iphone, config: baseConfig });
    const calls = await recordBeacons(v.page);
    await v.page.goto(PAGE);
    await v.page.waitForURL(APPSTORE);
    expect(calls).toEqual([]);
    await v.close();
  });

  const staying = { ...withDeferred, behavior: { redirect: false } };

  test("when the page stays, a tap on its own store badge is reported once, and the tap goes ahead", async ({
    browser,
  }) => {
    const v = await visit(browser, {
      userAgent: UA.iphone,
      config: staying,
      pageBody: `<a id="badge" href="${APPSTORE}"><span>Download on the App Store</span></a>`,
    });
    const calls = await recordBeacons(v.page);
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    expect(calls).toEqual([]);
    await v.page.locator("#badge span").click();
    await v.page.waitForURL(APPSTORE);
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual(["/dl/click", JSON.stringify({ url: PAGE })]);
    await v.close();
  });

  test("DeepLinker.go(choices.store) reports the click and goes to the store, referrer included", async ({
    browser,
  }) => {
    const v = await visit(browser, { userAgent: UA.androidChrome, config: staying });
    const calls = await recordBeacons(v.page);
    await v.page.goto(PAGE);
    await expect.poll(async () => (await v.events()).map((e) => e.name)).toContain("stay");
    await v.page.evaluate(() => {
      const w = window as unknown as {
        __events: { name: string; detail: { choices: { store: unknown } } }[];
        DeepLinker: { go: (to: unknown) => void };
      };
      w.DeepLinker.go(w.__events.find((e) => e.name === "decision")?.detail.choices.store);
    });
    await v.page.waitForURL(/^https:\/\/play\.google\.com\//);
    expect(new URL(v.page.url()).searchParams.get("referrer")).toBe(PAGE);
    await expect.poll(() => calls.length).toBe(1);
    await v.close();
  });
});

test.describe("routing rules", () => {
  const config = {
    ...baseConfig,
    paths: ["/app", "/property/*"],
    web: {
      url: "https://app.example.com",
      routes: [
        { from: "/app?lead=:id", to: "/applicants#:id" },
        { from: "/app?listing=:id", to: "/explore/listings#:id" },
        { from: "/property/:propertyId/leads?id=:leadId", to: "/property/leads?lead=:leadId&p=:propertyId" },
        { from: "/app", to: null },
      ],
    },
  };

  test("a desktop visitor is sent where the query says, and the token is not forwarded", async ({
    browser,
  }) => {
    const v = await visit(browser, { userAgent: UA.linuxFirefox, config });
    await v.page.goto("https://example.com/app?lead=abc123&token=secret#frag");
    await v.page.waitForURL("https://app.example.com/applicants#abc123");
    await v.close();
  });

  test("values are decoded and encoded again on the way", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.linuxFirefox, config });
    await v.page.goto("https://example.com/app?listing=REF%201+x");
    await v.page.waitForURL("https://app.example.com/explore/listings#REF%201%20x");
    await v.close();
  });

  test("any part of the URL can move to any part of the target", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.linuxFirefox, config });
    await v.page.goto("https://example.com/property/42/leads?id=abc&utm=x");
    await v.page.waitForURL("https://app.example.com/property/leads?lead=abc&p=42");
    await v.close();
  });

  test("with nothing to map, the page stays", async ({ browser }) => {
    const v = await visit(browser, { userAgent: UA.linuxFirefox, config });
    await v.page.goto("https://example.com/app");
    await v.page.waitForTimeout(800);
    expect(v.page.url()).toBe("https://example.com/app");
    await v.close();
  });
});
