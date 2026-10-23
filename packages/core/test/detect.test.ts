import { describe, expect, it } from "vitest";
import { BOTS } from "../src/data/bots";
import { IN_APP_BROWSERS } from "../src/data/in-app-browsers";
import { detect } from "../src/detect/detect";
import type { DetectInput, Env } from "../src/types";
import android from "../../../fixtures/user-agents/android.json";
import bots from "../../../fixtures/user-agents/bots.json";
import desktop from "../../../fixtures/user-agents/desktop.json";
import inApp from "../../../fixtures/user-agents/in-app.json";
import ios from "../../../fixtures/user-agents/ios.json";

interface Row extends DetectInput {
  name: string;
  expect: Partial<Env>;
}

const rows = [...ios, ...android, ...desktop, ...inApp, ...bots] as Row[];
const NO_SIGNALS = { ecosystem: null, inApp: null, bot: null } as const;

describe("fixture matrix", () => {
  it("has at least 60 rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(60);
  });

  it("has unique row names", () => {
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(rows.map((r) => [r.name, r] as const))("%s", (_name, row) => {
    const { name: _n, expect: want, ...input } = row;
    expect(detect(input)).toEqual({ ...NO_SIGNALS, ...want });
  });

  it("covers every OS, browser, ecosystem, in-app browser and bot the detector can report", () => {
    const seen = {
      os: new Set(rows.map((r) => r.expect.os)),
      browser: new Set(rows.map((r) => r.expect.browser)),
      ecosystem: new Set(rows.map((r) => r.expect.ecosystem)),
      inApp: new Set(rows.map((r) => r.expect.inApp)),
      bot: new Set(rows.map((r) => r.expect.bot)),
      deviceClass: new Set(rows.map((r) => r.expect.deviceClass)),
    };
    const missing = (universe: readonly string[], have: Set<unknown>) =>
      universe.filter((id) => !have.has(id));

    expect(
      missing(
        ["ios", "ipados", "android", "macos", "windows", "linux", "chromeos", "harmonyos", "unknown"],
        seen.os,
      ),
    ).toEqual([]);
    expect(
      missing(
        ["safari", "chrome", "firefox", "edge", "samsung", "huawei", "opera", "mi", "silk", "other"],
        seen.browser,
      ),
    ).toEqual([]);
    expect(missing(["google", "huawei", "samsung", "amazon", "xiaomi"], seen.ecosystem)).toEqual([]);
    expect(missing(["phone", "tablet", "desktop"], seen.deviceClass)).toEqual([]);
    expect(
      missing(
        IN_APP_BROWSERS.map(([id]) => id),
        seen.inApp,
      ),
    ).toEqual([]);
    expect(missing([...BOTS.map(([id]) => id), "empty-ua"], seen.bot)).toEqual([]);
  });
});

describe("data files", () => {
  it("have unique ids", () => {
    for (const table of [BOTS, IN_APP_BROWSERS]) {
      const ids = table.map(([id]) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("use only regex syntax that exists in ES2015", () => {
    const modern = /\(\?<[=!a-zA-Z]|\\p\{|\\P\{/;
    for (const [id, pattern] of [...BOTS, ...IN_APP_BROWSERS]) {
      expect(modern.test(pattern), `${id}: ${pattern}`).toBe(false);
      expect(() => new RegExp(pattern, "i"), id).not.toThrow();
    }
  });
});

describe("detect", () => {
  const macSafari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

  it("iPadOS Safari reporting Macintosh with maxTouchPoints 5 is an ipados tablet", () => {
    expect(detect({ ua: macSafari, maxTouchPoints: 5 })).toMatchObject({
      os: "ipados",
      deviceClass: "tablet",
    });
  });

  it("Macintosh with maxTouchPoints 0 stays macos", () => {
    expect(detect({ ua: macSafari, maxTouchPoints: 0 })).toMatchObject({
      os: "macos",
      deviceClass: "desktop",
    });
    expect(detect({ ua: macSafari })).toMatchObject({ os: "macos" });
  });

  it("Chrome Android with UA model K uses uaData.model SM-S918B to pick samsung", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    expect(detect({ ua }).ecosystem).toBe("google");
    expect(detect({ ua, uaData: { model: "SM-S918B" } }).ecosystem).toBe("samsung");
  });

  it("an empty Client Hints model falls back to the UA", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36";
    expect(detect({ ua, uaData: { model: "" } }).ecosystem).toBe("samsung");
  });

  it("Googlebot smartphone UA is a bot, not just an android phone", () => {
    const env = detect({
      ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    expect(env.bot).not.toBeNull();
    expect(env.os).toBe("android");
  });

  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "WhatsApp/2.23.20.0 A",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  ])("%s is a bot", (ua) => {
    expect(detect({ ua }).bot).not.toBeNull();
  });

  it("a real phone with Mobile Safari in its UA is not a bot", () => {
    const env = detect({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    expect(env.bot).toBeNull();
  });

  it("a missing UA is never a real browser", () => {
    expect(detect({ ua: "" }).bot).toBe("empty-ua");
    expect(detect({} as DetectInput).bot).toBe("empty-ua");
  });

  it("HarmonyOS reports harmonyos with the huawei ecosystem", () => {
    const env = detect({
      ua: "Mozilla/5.0 (Linux; Android 12; HarmonyOS; ALN-AL10; HMSCore 6.13.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0.1.303 Mobile Safari/537.36",
    });
    expect(env).toMatchObject({ os: "harmonyos", ecosystem: "huawei", browser: "huawei" });
  });

  it("Messenger wins over Facebook because its UA carries both", () => {
    const env = detect({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/MessengerForiOS;FBAV/460.0.0.46.108]",
    });
    expect(env.inApp).toBe("messenger");
  });

  it("a named in-app browser wins over the generic Android WebView", () => {
    const env = detect({
      ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Instagram 340.0.0.30.109 Android",
    });
    expect(env.inApp).toBe("instagram");
  });

  it("ecosystem is null away from Android", () => {
    expect(detect({ ua: macSafari }).ecosystem).toBeNull();
  });
});
