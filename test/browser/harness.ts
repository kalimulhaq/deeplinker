// Everything here runs against the built kit (packages/deeplinker/dist), the same code a user installs, and never
// touches the network: every request is answered by the test.
import type { Browser, Page } from "@playwright/test";
import { generate, parseConfig } from "../../packages/deeplinker/dist/index.js";

export const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  googlebot:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Instagram 340.0.0.30.109 Android",
};

export const FINGERPRINT =
  "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90";
export const APPSTORE = "https://apps.apple.com/app/id123456789";
export const PLAY = "https://play.google.com/store/apps/details?id=com.example.app";
export const GALAXY = "https://galaxystore.samsung.com/detail/com.example.app";

/** A config with every platform's target an https URL (the browser cannot follow `ms-windows-store://` or `intent://`). */
export const baseConfig = {
  domains: ["example.com"],
  paths: ["/property/*", "!/admin/*"],
  apps: {
    ios: { storeUrl: APPSTORE },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: [FINGERPRINT],
      stores: { samsung: GALAXY, google: PLAY },
    },
    windows: { downloadUrl: "https://example.com/download/windows" },
  },
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
};

/** deeplinker.js exactly as `deeplinker build` would write it for this config. */
export function deeplinkerJs(input: Record<string, unknown>): string {
  const parsed = parseConfig(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const file = generate(parsed.config).files.find((f) => f.path === "deeplinker.js");
  if (!file) throw new Error("no deeplinker.js generated");
  return file.content;
}

export interface Visit {
  page: Page;
  /** The `deeplinker:*` events the page fired, in order. */
  events: () => Promise<{ name: string; detail: unknown }[]>;
  close: () => Promise<void>;
}

/**
 * Opens a page as `userAgent` on https://example.com, which is answered by the test: pages get the script tag,
 * /deeplinker.js is generated from `config`, and any other host answers a one-line landing page, so a redirect can be
 * seen as the URL the browser ended up on.
 */
export async function visit(
  browser: Browser,
  opts: {
    userAgent: string;
    config: Record<string, unknown>;
    pageHead?: string;
    pageBody?: string;
    pageHtmlAttrs?: string;
  },
): Promise<Visit> {
  const context = await browser.newContext({ userAgent: opts.userAgent });
  const js = deeplinkerJs(opts.config);

  await context.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>landing</title><p>landed on ${route.request().url()}</p>`,
    }),
  );
  await context.route("https://example.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/deeplinker.js")
      return route.fulfill({ contentType: "application/javascript", body: js });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html ${opts.pageHtmlAttrs ?? 'lang="en"'}><head><meta charset="utf-8"><title>page</title>${opts.pageHead ?? ""}<script src="/deeplinker.js"></script></head><body><h1>page ${url.pathname}</h1>${opts.pageBody ?? ""}</body></html>`,
    });
  });
  await context.addInitScript(() => {
    const events: { name: string; detail: unknown }[] = [];
    (window as unknown as { __events: typeof events }).__events = events;
    for (const name of ["detect", "decision", "redirect", "stay", "error"]) {
      window.addEventListener("deeplinker:" + name, (e) =>
        events.push({ name, detail: (e as CustomEvent).detail }),
      );
    }
  });

  const page = await context.newPage();
  return {
    page,
    events: () =>
      page.evaluate(
        () => (window as unknown as { __events: { name: string; detail: unknown }[] }).__events ?? [],
      ),
    close: () => context.close(),
  };
}

/** The page as the test served it: deeplinker must never add to it or change it. */
export async function pageMarkup(page: Page): Promise<{ head: string[]; body: string }> {
  return page.evaluate(() => ({
    head: [...document.head.children].map((el) => el.outerHTML),
    body: document.body.innerHTML,
  }));
}
