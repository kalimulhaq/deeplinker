import { detect } from "@deeplinker/core/runtime";

/** The coarse device facts kept with a click, derived from request headers. Deliberately not the user agent itself. */
export interface Signals {
  os: string;
  osMajor: string;
  deviceClass: string;
  lang: string;
}

const first = (match: RegExpExecArray | null) => (match ? (match[1] as string) : "");

export function signalsFromHeaders(userAgent: string | null, acceptLanguage: string | null): Signals {
  const ua = userAgent ?? "";
  const env = detect({ ua });
  const osMajor =
    env.os === "ios" || env.os === "ipados"
      ? first(/OS (\d+)[_.]/.exec(ua))
      : env.os === "android"
        ? first(/Android (\d+)/.exec(ua))
        : "";
  return { os: env.os, osMajor, deviceClass: env.deviceClass, lang: primaryLanguage(acceptLanguage) };
}

/** "en-GB,en;q=0.9" -> "en". */
export function primaryLanguage(value: string | null | undefined): string {
  return /^\s*([a-z]{2,3})/i.exec(value ?? "")?.[1]?.toLowerCase() ?? "";
}

/** "17.5.1" -> "17". */
export function majorVersion(value: string | undefined): string {
  return /^\s*(\d+)/.exec(value ?? "")?.[1] ?? "";
}

/** Which store family a click came from: iOS and iPadOS share the App Store, Android and HarmonyOS the Android stores. */
export function platformOf(os: string): "ios" | "android" | "other" {
  return os === "ios" || os === "ipados"
    ? "ios"
    : os === "android" || os === "harmonyos"
      ? "android"
      : "other";
}
