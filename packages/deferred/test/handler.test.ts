import { describe, expect, it } from "vitest";
import { createHandler } from "../src/handler";
import { memoryStore } from "../src/stores/memory";
import type { MatchResponse, Settings } from "../src/types";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const settings: Settings = { hosts: ["example.com", "www.example.com"], ttlSeconds: 3600, clipboard: false };
const URL_A = "https://example.com/property/42?a=1&a=2&b=#top";

function setup(over: Partial<Settings> = {}) {
  let clock = 1_700_000_000_000;
  let counter = 0;
  const store = memoryStore();
  const handle = createHandler({
    settings: { ...settings, ...over },
    store,
    now: () => clock,
    id: () => `id-${++counter}`,
    ip: (request) => request.headers.get("x-test-ip"),
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    handle(
      new Request(`https://example.com${path}`, {
        method: "POST",
        headers: {
          "x-test-ip": "203.0.113.10",
          "user-agent": IPHONE,
          "accept-language": "en-GB,en;q=0.9",
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { handle, store, post, advance: (ms: number) => (clock += ms), now: () => clock };
}

const matchBody = async (res: Response) => (await res.json()) as MatchResponse;

describe("routing", () => {
  it("answers whatever it is mounted at: the last path segment decides", async () => {
    const { post } = setup();
    for (const path of ["/dl/click", "/click", "/api/dl/click", "/dl/click/"]) {
      expect((await post(path, { url: URL_A })).status, path).toBe(204);
    }
  });

  it("404 for anything else, 405 with Allow for a GET", async () => {
    const { handle, post } = setup();
    expect((await post("/dl/other", {})).status).toBe(404);
    const get = await handle(new Request("https://example.com/dl/match"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });
});

describe("click", () => {
  it("accepts a URL on one of your hosts and says nothing (204)", async () => {
    const { post } = setup();
    const res = await post("/dl/click", { url: URL_A });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("accepts text/plain bodies, which is what navigator.sendBeacon sends", async () => {
    const { post } = setup();
    expect(
      (
        await post("/dl/click", JSON.stringify({ url: URL_A }), {
          "content-type": "text/plain;charset=UTF-8",
        })
      ).status,
    ).toBe(204);
  });

  it.each([
    ["another host", "https://evil.example.org/p"],
    ["a look-alike host", "https://example.com.evil.org/p"],
    ["javascript:", "javascript:alert(1)"],
    ["not a URL", "property/42"],
    ["too long", "https://example.com/" + "a".repeat(3000)],
  ])("refuses %s", async (_name, url) => {
    const { post } = setup();
    const res = await post("/dl/click", { url });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_url" });
  });

  it("refuses a body that is not JSON, not an object, or too large", async () => {
    const { post } = setup();
    expect((await post("/dl/click", "{ nope")).status).toBe(400);
    expect((await post("/dl/click", "[1]")).status).toBe(400);
    expect((await post("/dl/click", { url: URL_A, junk: "x".repeat(5000) })).status).toBe(413);
  });

  it("stores nothing when it cannot tell where the request came from, and still answers 204", async () => {
    const { handle, store } = setup();
    const res = await handle(
      new Request("https://example.com/dl/click", { method: "POST", body: JSON.stringify({ url: URL_A }) }),
    );
    expect(res.status).toBe(204);
    expect(await store.findByPrefix("0.0.0.0/24", 0)).toEqual([]);
  });
});

describe("match: iOS is probabilistic and says so", () => {
  const ios = { platform: "ios", osVersion: "17.5.1", deviceClass: "phone", language: "en-US" };

  it("returns the clicked URL, labelled probabilistic, and forgets it", async () => {
    const { post } = setup();
    await post("/dl/click", { url: URL_A });
    const first = await matchBody(await post("/dl/match", ios));
    expect(first).toMatchObject({ match: "probabilistic", url: URL_A });
    expect(first.confidence).toBeGreaterThan(0);
    expect(first.confidence).toBeLessThanOrEqual(1);
    expect(await matchBody(await post("/dl/match", ios))).toEqual({ match: "none" });
  });

  it("returns the URL byte for byte", async () => {
    const odd = "https://example.com/p/caf%C3%A9?q=a+b&r=a%20b&r=2&z=#/spa?x=1";
    const { post } = setup();
    await post("/dl/click", { url: odd });
    expect((await matchBody(await post("/dl/match", ios))).url).toBe(odd);
  });

  it("only matches a device on the same network (same /24)", async () => {
    const { post } = setup();
    await post("/dl/click", { url: URL_A });
    expect((await matchBody(await post("/dl/match", ios, { "x-test-ip": "198.51.100.9" }))).match).toBe(
      "none",
    );
    expect((await matchBody(await post("/dl/match", ios, { "x-test-ip": "203.0.113.200" }))).match).toBe(
      "probabilistic",
    );
  });

  it("does not match a different OS version, platform, or an expired click", async () => {
    const { post, advance } = setup();
    await post("/dl/click", { url: URL_A });
    expect((await matchBody(await post("/dl/match", { ...ios, osVersion: "16.1" }))).match).toBe("none");
    expect((await matchBody(await post("/dl/match", { ...ios, platform: "android" }))).match).toBe("none");
    advance(3600 * 1000 + 1);
    expect((await matchBody(await post("/dl/match", ios))).match).toBe("none");
  });

  it("an Android click does not satisfy an iOS ask", async () => {
    const { post } = setup();
    await post("/dl/click", { url: URL_A }, { "user-agent": ANDROID });
    expect((await matchBody(await post("/dl/match", ios))).match).toBe("none");
  });

  it("with several clicks it picks the best fit, then the newest, and is less sure when tied", async () => {
    const { post, advance } = setup();
    await post("/dl/click", { url: "https://example.com/older" });
    advance(1000);
    await post("/dl/click", { url: "https://example.com/newer" });
    const tied = await matchBody(await post("/dl/match", ios));
    expect(tied.url).toBe("https://example.com/newer");

    const { post: post2, advance: advance2 } = setup();
    await post2("/dl/click", { url: "https://example.com/fr" }, { "accept-language": "fr-FR" });
    advance2(1000);
    await post2("/dl/click", { url: "https://example.com/en" }, { "accept-language": "en-GB" });
    advance2(1000);
    await post2("/dl/click", { url: "https://example.com/fr2" }, { "accept-language": "fr-FR" });
    const best = await matchBody(await post2("/dl/match", ios));
    expect(best.url).toBe("https://example.com/en"); // the language fits, so it beats the newer click

    const lone = setup();
    await lone.post("/dl/click", { url: URL_A });
    const sure = await matchBody(await lone.post("/dl/match", ios));
    const unsure = tied;
    expect(unsure.confidence).toBeLessThan(sure.confidence as number);
  });

  it("with no OS version to compare it still matches, with lower confidence", async () => {
    const { post } = setup();
    await post("/dl/click", { url: URL_A });
    const res = await matchBody(await post("/dl/match", { platform: "ios" }));
    expect(res).toMatchObject({ match: "probabilistic", url: URL_A });
    expect(res.confidence).toBeLessThanOrEqual(0.25);
  });

  it("an unknown platform gets none, never a guess", async () => {
    const { post } = setup();
    await post("/dl/click", { url: URL_A });
    expect(await matchBody(await post("/dl/match", { platform: "other" }))).toEqual({ match: "none" });
    expect(await matchBody(await post("/dl/match", {}))).toEqual({ match: "none" });
  });
});

describe("match: Android is deterministic through the Install Referrer", () => {
  it("returns the URL from the referrer without any stored click", async () => {
    const { post } = setup();
    expect(await matchBody(await post("/dl/match", { platform: "android", installReferrer: URL_A }))).toEqual(
      {
        match: "deterministic",
        url: URL_A,
      },
    );
  });

  it("accepts the referrer still percent-encoded once, as Play's docs do not say which form the API returns", async () => {
    const { post } = setup();
    const encoded = encodeURIComponent(URL_A);
    expect(encoded).not.toBe(URL_A);
    expect(
      await matchBody(await post("/dl/match", { platform: "android", installReferrer: encoded })),
    ).toEqual({
      match: "deterministic",
      url: URL_A,
    });
  });

  it("never decodes twice: a URL that already holds percent escapes comes back exactly as it was", async () => {
    const { post } = setup();
    const url = "https://example.com/p?c=%C3%BC&q=a%2Bb";
    expect(await matchBody(await post("/dl/match", { platform: "android", installReferrer: url }))).toEqual({
      match: "deterministic",
      url,
    });
    expect(
      await matchBody(
        await post("/dl/match", { platform: "android", installReferrer: encodeURIComponent(url) }),
      ),
    ).toEqual({ match: "deterministic", url });
  });

  it("an encoded referrer that is malformed or not yours is still refused", async () => {
    const { post } = setup();
    for (const installReferrer of [
      "https%3A%2F%2Fexample.com%2Fa%ZZ",
      "https%3A%2F%2Fexample.com%2F%FF",
      encodeURIComponent("https://evil.example.org/x"),
      encodeURIComponent("javascript:alert(1)"),
    ]) {
      expect(
        (await matchBody(await post("/dl/match", { platform: "android", installReferrer }))).match,
        installReferrer,
      ).toBe("none");
    }
  });

  it("ignores a referrer that is not one of your URLs (campaign strings, other sites) and falls back", async () => {
    const { post } = setup();
    await post("/dl/click", { url: URL_A }, { "user-agent": ANDROID });
    const res = await matchBody(
      await post("/dl/match", {
        platform: "android",
        osVersion: "13",
        installReferrer: "utm_source=google-play&utm_medium=organic",
      }),
    );
    expect(res).toMatchObject({ match: "probabilistic", url: URL_A });
    expect(
      (
        await matchBody(
          await post("/dl/match", { platform: "android", installReferrer: "https://evil.example.org/x" }),
        )
      ).match,
    ).toBe("none");
  });
});

describe("match: the clipboard method is off unless enabled", () => {
  it("is ignored by default", async () => {
    const { post } = setup();
    expect((await matchBody(await post("/dl/match", { platform: "ios", clipboard: URL_A }))).match).toBe(
      "none",
    );
  });

  it("returns a URL read from the pasteboard when enabled, but only one of yours", async () => {
    const { post } = setup({ clipboard: true });
    expect(await matchBody(await post("/dl/match", { platform: "ios", clipboard: URL_A }))).toEqual({
      match: "clipboard",
      url: URL_A,
    });
    expect(
      (await matchBody(await post("/dl/match", { platform: "ios", clipboard: "https://evil.example.org/x" })))
        .match,
    ).toBe("none");
    expect(
      (await matchBody(await post("/dl/match", { platform: "ios", clipboard: "just some text I copied" })))
        .match,
    ).toBe("none");
  });
});

describe("what is kept, and what is not", () => {
  it("keeps a /24, coarse device facts and the URL: not the address, not the user agent", async () => {
    const { post, store } = setup();
    await post("/dl/click", { url: URL_A });
    const [record] = await store.findByPrefix("203.0.113.0/24", 1_700_000_000_000);
    expect(record).toEqual({
      id: "id-1",
      url: URL_A,
      ts: 1_700_000_000_000,
      ipPrefix: "203.0.113.0/24",
      os: "ios",
      osMajor: "17",
      deviceClass: "phone",
      lang: "en",
    });
    const text = JSON.stringify(record);
    expect(text).not.toContain("203.0.113.10");
    expect(text).not.toContain("Mozilla");
    expect(text).not.toContain("en-GB");
  });

  it("never sets a cookie, and nothing is cacheable", async () => {
    const { post } = setup();
    for (const [path, body] of [
      ["/dl/click", { url: URL_A }],
      ["/dl/match", { platform: "ios" }],
      ["/dl/click", { url: "x" }],
    ] as const) {
      const res = await post(path, body);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("every other answer is just as uncacheable and cookie-free: 404, 405 and 413 too", async () => {
    const { handle, post } = setup();
    const answers = [
      await post("/dl/other", {}),
      await handle(new Request("https://example.com/dl/match")),
      await post("/dl/click", { url: URL_A, pad: "x".repeat(5000) }),
    ];
    expect(answers.map((r) => r.status)).toEqual([404, 405, 413]);
    for (const res of answers) {
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("a storage failure is a 500, not a crash or a leak of the error", async () => {
    const store = memoryStore();
    store.put = async () => {
      throw new Error("db password is hunter2");
    };
    const handle = createHandler({ settings, store, ip: () => "203.0.113.10" });
    const res = await handle(
      new Request("https://example.com/dl/click", { method: "POST", body: JSON.stringify({ url: URL_A }) }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});
