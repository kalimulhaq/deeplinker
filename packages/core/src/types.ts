import type { ANDROID_STORE_IDS, HOSTING_IDS } from "./constants";

export type OS =
  "ios" | "ipados" | "android" | "macos" | "windows" | "linux" | "chromeos" | "harmonyos" | "unknown";
export type DeviceClass = "phone" | "tablet" | "desktop";
export type BrowserId =
  "safari" | "chrome" | "firefox" | "edge" | "samsung" | "huawei" | "opera" | "mi" | "silk" | "other";
/** Android store ecosystem. `google` is the default (Play Services present). */
export type Ecosystem = "google" | "huawei" | "samsung" | "amazon" | "xiaomi";
export type AndroidStoreId = (typeof ANDROID_STORE_IDS)[number];
export type HostId = (typeof HOSTING_IDS)[number];

export type StoreId =
  | "appstore"
  | "macappstore"
  | "google"
  | "huawei"
  | "samsung"
  | "amazon"
  | "xiaomi"
  | "microsoft"
  | "flathub"
  | "snap"
  | "download";

/** What the detector learned about the visitor. Every field is always present. */
export interface Env {
  os: OS;
  deviceClass: DeviceClass;
  browser: BrowserId;
  /** Only set for android / harmonyos. */
  ecosystem: Ecosystem | null;
  /** Id from data/in-app-browsers.ts, or null. */
  inApp: string | null;
  /** Id from data/bots.ts, or null. */
  bot: string | null;
}

export interface DetectInput {
  ua: string;
  /** `navigator.platform` */
  platform?: string;
  /** `navigator.maxTouchPoints` */
  maxTouchPoints?: number;
  /** Client Hints: `navigator.userAgentData`, plus high-entropy values when they were requested. */
  uaData?: {
    mobile?: boolean;
    platform?: string;
    model?: string;
    platformVersion?: string;
  };
}

/** The part of a URL the router looks at. `search` includes `?`, `hash` includes `#`; both are raw. */
export interface Loc {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * A rule that looks beyond the path. Every key named must match. `query` is `{ name: pattern }` (the parameter must be
 * present with a matching value), the one query form Apple, Android and the browser runtime all understand.
 */
export interface PathRuleObject {
  path?: string;
  query?: Record<string, string>;
  fragment?: string;
}
export type PathRule = string | PathRuleObject;
export interface PathsConfig {
  include?: PathRule[];
  exclude?: PathRule[];
}
/**
 * One routing rule from the config: `from` and `to` are URL templates (`path?query#fragment`). See paths/route.ts.
 * `to: null` says the URL has no web equivalent.
 */
export interface PathMapRule {
  from: string;
  to: string | null;
}

/** A rule as the browser runs it, so nothing has to be parsed there. Built by `compileRoute`. */
export interface CompiledRoute {
  /** Regex source for the path. The groups are the path's captures, then a last one: the optional trailing slash. */
  p: string;
  /** Query parameters that must be present, each with a regex source for its decoded, trimmed value ("" = only present). */
  q?: [name: string, pattern: string][];
  /** Regex source for the decoded fragment. */
  f?: string;
  /**
   * The target, in pieces: text as it is, a number n for capture n (decoded, then encoded), -(n + 1) for a `*` capture
   * as it was written. Captures are numbered path first, then the query values in order, then the fragment.
   * `null`: no web equivalent.
   */
  t: (string | number)[] | null;
  /** A path-only rule: the original query, fragment and trailing slash are kept. */
  k?: 1;
}

export interface Target {
  kind: "store" | "web" | "intent";
  url: string;
  store?: StoreId;
}

export interface Decision {
  action: "none" | "redirect" | "intent" | "prompt" | "escape";
  /** Machine-readable cause, e.g. `bot`, `skip-param`, `guard`, `not-deep-link-path`, `store`, `web`, `no-target`. */
  reason: string;
  target?: Target;
  /** Everything a custom UI might offer, whatever the action. */
  choices: { open?: string; store?: Target; web?: Target };
  /**
   * Whether this browser hands verified links to the OS: yes, sometimes, or never. Windows browsers never do:
   * https://learn.microsoft.com/en-us/windows/apps/develop/launch/web-to-app-linking
   */
  linkHandling: "os" | "partial" | "none";
  delayMs: number;
}

/** The slice of the config the browser needs. Built by `toRuntimeConfig()`; defaults are already applied. */
export interface RuntimeConfig {
  v: 1;
  /** The config's `domains`, lower-case. Used for same-site checks. */
  hosts: string[];
  paths?: PathsConfig;
  apps: {
    ios?: { storeUrl?: string };
    android?: {
      pkg?: string;
      scheme?: string;
      stores: Partial<Record<AndroidStoreId, string>>;
      priority: AndroidStoreId[];
    };
    macos?: { storeUrl?: string; downloadUrl?: string };
    windows?: { storeUrl?: string; downloadUrl?: string };
    linux?: { stores: { flathub?: string; snap?: string }; downloadUrl?: string };
    chromeos?: { useAndroidApp: boolean };
  };
  web?: { url: string; routes?: CompiledRoute[] };
  behavior: {
    redirect: boolean;
    delayMs: number;
    inAppEscape: boolean;
    bots: boolean;
    guardParam: string;
  };
  /** Deferred deep linking: where to report a click that is about to reach a store. Absent when it is off. */
  deferred?: {
    /** Path on your own site, e.g. `/dl/click`. */
    url: string;
  };
  debug: boolean;
}
