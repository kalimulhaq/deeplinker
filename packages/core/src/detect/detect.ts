import { BOTS } from "../data/bots";
import { IN_APP_BROWSERS } from "../data/in-app-browsers";
import type { BrowserId, DetectInput, DeviceClass, Ecosystem, Env, OS } from "../types";

// Browser bundle: ES2015 target and a size budget, so no `?.`, `??` or object spread (see decide.ts).

type Table = readonly (readonly [string, RegExp])[];

const compile = (rows: readonly (readonly [string, string, ...unknown[]])[]): Table =>
  rows.map(([id, pattern]) => [id, new RegExp(pattern, "i")] as const);

const bots = compile(BOTS);
const inApps = compile(IN_APP_BROWSERS);

/** First match wins, so the order matters: Edge, Opera and the OEM browsers all say "Chrome" too. */
const BROWSERS: readonly (readonly [BrowserId, RegExp])[] = [
  ["edge", /Edg(?:e|A|iOS)?\//],
  ["opera", /OPR\/|OPT\/|OPiOS|Opera/],
  ["samsung", /SamsungBrowser/],
  ["huawei", /HuaweiBrowser/],
  ["mi", /MiuiBrowser|MiBrowser/],
  ["silk", /Silk\//],
  ["firefox", /Firefox\/|FxiOS\//],
  ["other", /ArkWeb/],
  ["chrome", /Chrome\/|CriOS\/|Chromium/],
  ["safari", /Safari\/|AppleWebKit/],
];

function firstMatch<T extends string>(table: readonly (readonly [T, RegExp])[], text: string): T | null {
  for (const [id, re] of table) if (re.test(text)) return id;
  return null;
}

function detectOS(ua: string, platform: string, touchPoints: number): OS {
  if (/OpenHarmony|HarmonyOS/i.test(ua)) return "harmonyos";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/iPad/.test(ua)) return "ipados";
  if (/CrOS/.test(ua) || /^chrom(e|ium) ?os$/.test(platform)) return "chromeos";
  if (/Android/.test(ua) || platform === "android") return "android";
  // iPadOS 13+ Safari sends a macOS user agent; only a touch screen gives it away.
  if (/Macintosh|Mac OS X/.test(ua) || platform === "macos") return touchPoints > 1 ? "ipados" : "macos";
  if (/Windows/.test(ua) || platform === "windows") return "windows";
  if (/Linux|X11/.test(ua) || platform === "linux") return "linux";
  return "unknown";
}

/** The device model: the Client Hint when present, else the token in the user agent (Chrome reduces it to "K"). */
function deviceModel(ua: string, hint: string | undefined): string {
  if (hint && hint.length > 1) return hint;
  const m = /;\s*([^;()]+?)\s+Build\//.exec(ua) || /Android [\d.]+;\s*([^;)]+)/.exec(ua);
  const model = m ? (m[1] as string).trim() : "";
  return model.length > 1 ? model : "";
}

function detectEcosystem(ua: string, os: OS, model: string): Ecosystem {
  if (os === "harmonyos" || /HMSCore|HuaweiBrowser/.test(ua)) return "huawei";
  if (/SamsungBrowser/.test(ua) || /^SM-|^SAMSUNG/i.test(model)) return "samsung";
  if (/Silk\/|\bKF[A-Z]{2,}\b|\bAFT[A-Z]*\b/.test(ua) || /^(?:KF[A-Z]{2,}|AFT[A-Z]*)$/.test(model))
    return "amazon";
  if (
    /MiuiBrowser|XiaoMi|MIUI/i.test(ua) ||
    /^(?:Redmi|POCO|Mi |MI |M\d{4}[A-Z]\d)/.test(model) ||
    /^[12]\d{6,9}[A-Z]{0,3}\d?[A-Z]?$/.test(model)
  ) {
    return "xiaomi";
  }
  return "google";
}

/**
 * What kind of visitor is this? Client Hints are used when the browser sends them (Chromium), the user-agent string
 * otherwise. The result always has every field; nothing here guesses beyond the data in `data/`.
 */
export function detect(input: DetectInput): Env {
  const ua = input.ua || "";
  const hints = input.uaData || {};
  const os = detectOS(ua, (hints.platform || "").toLowerCase(), input.maxTouchPoints || 0);

  let deviceClass: DeviceClass = "desktop";
  if (os === "ios") deviceClass = "phone";
  else if (os === "ipados") deviceClass = "tablet";
  else if (os === "android" || os === "harmonyos") {
    deviceClass = (hints.mobile !== undefined ? hints.mobile : /Mobile|Phone;/.test(ua)) ? "phone" : "tablet";
  }

  const bot = ua ? firstMatch(bots, ua) : "empty-ua";

  return {
    os,
    deviceClass,
    browser: firstMatch(BROWSERS, ua) || "other",
    ecosystem:
      os === "android" || os === "harmonyos" ? detectEcosystem(ua, os, deviceModel(ua, hints.model)) : null,
    // A crawler is never "inside" an app, even when its name contains one ("TelegramBot").
    inApp: bot ? null : firstMatch(inApps, ua),
    bot,
  };
}
