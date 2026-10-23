import { detect, type DetectInput, type Env } from "@deeplinker/core/runtime";

interface UAData {
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>;
}

/** Runs `fn` and resolves to its result, or to undefined if it has not settled after `ms`. Rejections propagate. */
const within = <T>(fn: () => Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([Promise.resolve().then(fn), new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);

/**
 * Who is visiting. Chrome hides the Android model in its user agent ("K"), so on an Android that looks like a stock
 * Google device the `model` Client Hint is asked for, briefly, to tell Samsung, Xiaomi and Fire OS apart.
 */
export function readEnv(): Promise<Env> {
  const n = navigator as Navigator & { userAgentData?: UAData };
  const ud = n.userAgentData;
  const input: DetectInput = {
    ua: n.userAgent,
    platform: n.platform,
    maxTouchPoints: n.maxTouchPoints,
    uaData: ud && { mobile: ud.mobile, platform: ud.platform },
  };
  const env = detect(input);
  if (!ud || !ud.getHighEntropyValues || env.os !== "android" || env.ecosystem !== "google") {
    return Promise.resolve(env);
  }
  return within(
    () => (ud.getHighEntropyValues as NonNullable<UAData["getHighEntropyValues"]>).call(ud, ["model"]),
    300,
  ).then(
    (hints) => {
      if (!hints || !hints.model) return env;
      (input.uaData as { model?: string }).model = hints.model; // `input` is ours: nothing else reads it
      return detect(input);
    },
    () => env,
  );
}

/**
 * `navigator.getInstalledRelatedApps()` (Chromium, secure context, apps declared in the manifest). true = it reported
 * an app; false = none; undefined = not available or it failed. Never read "false" as "not installed".
 */
export function relatedAppInstalled(): Promise<boolean | undefined> {
  const n = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
  if (typeof n.getInstalledRelatedApps !== "function") return Promise.resolve(undefined);
  return within(() => (n.getInstalledRelatedApps as () => Promise<unknown[]>).call(n), 800).then(
    (apps) => (apps ? apps.length > 0 : undefined),
    () => undefined,
  );
}
