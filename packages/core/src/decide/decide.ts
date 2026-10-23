import { IN_APP_MANUAL } from "../data/in-app-browsers";
import { buildAppIntent, buildBrowserEscapeIntent } from "../intent/intent";
import { matchesDeepLinkPath } from "../paths/match";
import { toWebAppUrl } from "../paths/path-map";
import { resolveStore, withPlayReferrer } from "../store/resolve";
import type { Decision, Env, RuntimeConfig, Target } from "../types";
import { splitUrl } from "../url/preserve";

export interface DecideContext {
  env: Env;
  /** `location.href`, never `pathname + search`: `location.search` drops a bare `?`. */
  href: string;
  config: RuntimeConfig;
  /** The loop guard is already set in `sessionStorage`. */
  guardSet: boolean;
  /** `sessionStorage` works. When it does not, a same-site redirect carries the skip parameter instead. */
  storageOk: boolean;
  /** `getInstalledRelatedApps()` result: true = reports the app, false = does not, undefined = unavailable or failed. */
  relatedAppInstalled: boolean | undefined;
}

// This file ships in the browser bundle, which targets ES2015 and has a size budget: no `?.`, `??` or object spread
// here, because the build lowers them to helpers that cost more than the code they replace.

/** Where a loaded page says nothing about whether the app is installed (ChromeOS runs Android apps, so it is not here). */
const DESKTOP: Env["os"][] = ["macos", "windows", "linux"];

const hostOf = (origin: string) => origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").toLowerCase();

function normalize(href: string): string {
  const u = splitUrl(href);
  return u.origin.toLowerCase() + u.pathname + u.search + u.hash;
}

/** Whether the query has `name` set to anything but 0 or false (`?dl_skip`, `?dl_skip=1`, `?dl_skip=true`). */
const hasParam = (search: string, name: string): boolean =>
  new RegExp("[?&]" + name.replace(/\./g, "\\.") + "(?:=(?!(?:0|false)(?:&|$))|&|$)", "i").test(search);

/** Appends `name=1` after the existing query and before the hash, leaving everything else as it was. */
function withParam(url: string, name: string): string {
  const hash = url.indexOf("#");
  const head = hash < 0 ? url : url.slice(0, hash);
  return head + (head.indexOf("?") < 0 ? "?" : "&") + name + "=1" + (hash < 0 ? "" : url.slice(hash));
}

/** Does this browser hand verified links to the OS? Windows, Linux and most desktop browsers never do. */
function linkHandling(env: Env): Decision["linkHandling"] {
  switch (env.os) {
    case "ios":
    case "ipados":
    case "chromeos":
    case "harmonyos":
      return "partial";
    case "android":
      return env.browser === "firefox" ? "partial" : "os";
    case "macos":
      return env.browser === "safari" ? "partial" : "none";
    default:
      return "none";
  }
}

/**
 * The routing rules. Pure: every input is in `ctx`, so the browser runtime, the tests and a custom UI all get the
 * same answer. Rules A1/B1 (an installed app is opened by the OS) never reach this function: no JS runs when the OS
 * handles the link, so what is decided here is only what to do when the page did load.
 */
export function decide(ctx: DecideContext): Decision {
  const { env, href, config, guardSet, storageOk, relatedAppInstalled } = ctx;
  const { behavior, apps } = config;
  const loc = splitUrl(href);
  const host = hostOf(loc.origin);
  const handling = linkHandling(env);
  const end = (action: Decision["action"], reason: string, rest?: Partial<Decision>): Decision =>
    Object.assign({ action, reason, choices: {}, linkHandling: handling, delayMs: 0 }, rest);

  // 1. Never touch crawlers, an explicit skip, or a page we already redirected from.
  if (behavior.bots && env.bot) return end("none", "bot");
  if (hasParam(loc.search, behavior.guardParam)) return end("none", "skip-param");
  if (guardSet) return end("none", "guard");
  // 2. Only configured deep-link paths.
  if (!matchesDeepLinkPath(loc, config.paths)) return end("none", "not-deep-link-path");
  // A bare Android WebView could be the site's own app, and links do not open apps from a WebView anyway.
  if (env.inApp === "webview") return end("none", "webview");

  // The places this visitor could be sent.
  const hit = resolveStore(env, apps);
  const store: Target | undefined = hit
    ? {
        kind: "store",
        store: hit.store,
        url: hit.store === "google" ? withPlayReferrer(hit.url, href) : hit.url,
      }
    : undefined;

  let web: Target | undefined;
  if (config.web) {
    let url = toWebAppUrl(loc, config.web);
    // A web app that lives at the very URL we are on is a loop, not a destination.
    if (url && normalize(url) !== normalize(href)) {
      const sameSite = config.hosts.indexOf(hostOf(splitUrl(url).origin)) >= 0;
      if (!storageOk && sameSite) url = withParam(url, behavior.guardParam);
      web = { kind: "web", url };
    }
  }

  const android = apps.android;
  const intentLoc = { host, pathname: loc.pathname, search: loc.search };
  /** The link that opens the installed app, for a page that offers it. Only Android has a scripted way to do that. */
  const openHref = (fallback?: Target): string | undefined => {
    if (env.os === "android" && android && (android.scheme || android.pkg)) {
      return buildAppIntent({
        scheme: android.scheme || "https",
        pkg: android.pkg,
        loc: intentLoc,
        fallbackUrl: fallback && fallback.url,
      });
    }
    return undefined;
  };

  const fallback = store || web;
  const choices: Decision["choices"] = {};
  const open = openHref(fallback);
  if (open) choices.open = open;
  if (store) choices.store = store;
  if (web) choices.web = web;

  // 3. In-app browser: offer a way out instead of routing.
  if (env.inApp && behavior.inAppEscape) {
    const target: Target | undefined =
      env.os === "android" && !IN_APP_MANUAL.has(env.inApp)
        ? { kind: "intent", url: buildBrowserEscapeIntent(intentLoc) }
        : undefined;
    return end("escape", "in-app-browser", { choices, target });
  }

  // 4. The browser says the app is installed: stay, and never send them to a store. The page can offer `choices.open`.
  if (relatedAppInstalled === true) {
    const installed = openHref(web);
    return installed
      ? end("prompt", "related-app-installed", {
          choices: web ? { open: installed, web } : { open: installed },
        })
      : end("none", "no-target");
  }

  if (!open && !store && !web) return end("none", "no-target");

  // 8. `redirect: false` never navigates: the page offers the choices itself. Decided before any automatic navigation.
  if (!behavior.redirect) return end("prompt", "redirect-off", { choices, target: fallback });

  // 5. Android Chrome with a custom scheme: one more chance to open the app, falling back to the store or web app.
  if (
    env.os === "android" &&
    env.browser === "chrome" &&
    !env.inApp &&
    android &&
    android.scheme &&
    fallback
  ) {
    return end("intent", "android-intent", {
      choices,
      target: {
        kind: "intent",
        url: buildAppIntent({
          scheme: android.scheme,
          pkg: android.pkg,
          loc: intentLoc,
          fallbackUrl: fallback.url,
        }),
      },
      delayMs: behavior.delayMs,
    });
  }

  // 6. The store for this device, else the web app, else stay. Not a desktop store, though: desktop browsers keep links
  // in the browser even when the app is installed, so the page cannot tell, and a store redirect would send people who
  // have the app to the store. A desktop visitor goes to the web app, or stays with the store offered in `choices`.
  if (store && DESKTOP.indexOf(env.os) >= 0) {
    return web
      ? end("redirect", "web", { choices, target: web, delayMs: behavior.delayMs })
      : end("prompt", "desktop-store", { choices, target: store });
  }
  const target = store || web;
  if (!target) return end("none", "no-target", { choices });
  return end("redirect", store ? "store" : "web", { choices, target, delayMs: behavior.delayMs });
}
