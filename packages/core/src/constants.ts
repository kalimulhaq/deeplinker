/** The published package name. Change it here and in packages/deeplinker/package.json (a test keeps them in sync). */
export const PACKAGE_NAME = "@kalimulhaq/deeplinker";
/** The CLI binary name: `npx deeplinker <command>`. */
export const BIN_NAME = "deeplinker";
/** `window.<RUNTIME_GLOBAL>` in the UMD and IIFE builds. */
export const RUNTIME_GLOBAL = "DeepLinker";

export const DEFAULT_LOOP_GUARD_PARAM = "dl_skip";
export const DEFAULT_OUT_DIR = "deeplinker-dist";
export const DEFAULT_MANIFEST_PATH = "/manifest.json";

/** Names `deeplinker` looks for, in order, when `--config` is not given. */
export const CONFIG_FILE_NAMES = [
  "deeplinker.config.ts",
  "deeplinker.config.mts",
  "deeplinker.config.js",
  "deeplinker.config.mjs",
  "deeplinker.config.json",
] as const;

export const WELL_KNOWN_DIR = ".well-known";
export const AASA_PATH = ".well-known/apple-app-site-association";
export const ASSETLINKS_PATH = ".well-known/assetlinks.json";
export const WINDOWS_LINK_PATH = ".well-known/windows-app-web-link";
export const RUNTIME_FILE = "deeplinker.js";

export const ANDROID_STORE_IDS = ["google", "huawei", "samsung", "amazon", "xiaomi"] as const;

export const HOSTING_IDS = [
  "apache",
  "nginx",
  "vercel",
  "netlify",
  "cloudflare",
  "laravel",
  "wordpress",
  "static",
] as const;

/**
 * Play's `referrer` must be URL-encoded and at most 512 characters
 * (https://developer.android.com/games/playgames/user-acquisition).
 */
export const PLAY_REFERRER_MAX = 512;

/** Digital Asset Links relation used for App Links (https://developer.android.com/training/app-links/configure-assetlinks). */
export const HANDLE_ALL_URLS = "delegate_permission/common.handle_all_urls";
