import { describe, expect, it } from "vitest";
import { configHash, toRuntimeConfig } from "../src/config/runtime-config";
import { parseConfig } from "../src/config/parse";
import { buildAppIntent, buildBrowserEscapeIntent } from "../src/intent/intent";

const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

function resolved(input: unknown) {
  const r = parseConfig(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}

describe("buildAppIntent", () => {
  const loc = { host: "example.com", pathname: "/property/42", search: "?a=1&a=2&b=" };

  it("has the scheme, the package, an encoded fallback and no hash", () => {
    const fallback = "https://play.google.com/store/apps/details?id=com.example.app&referrer=x%3D1";
    const url = buildAppIntent({ scheme: "exampleapp", pkg: "com.example.app", loc, fallbackUrl: fallback });
    expect(url).toBe(
      "intent://example.com/property/42?a=1&a=2&b=#Intent;scheme=exampleapp;package=com.example.app;" +
        `S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
    );
    expect(url.split("#")).toHaveLength(2);
  });

  it("omits package and fallback when they are not given", () => {
    expect(
      buildAppIntent({ scheme: "exampleapp", loc: { host: "example.com", pathname: "/", search: "" } }),
    ).toBe("intent://example.com/#Intent;scheme=exampleapp;end");
  });

  it("copies path and query exactly as they came", () => {
    const url = buildAppIntent({
      scheme: "s",
      loc: { host: "example.com", pathname: "/caf%C3%A9", search: "?q=a+b&r=a%20b&z=" },
    });
    expect(url.startsWith("intent://example.com/caf%C3%A9?q=a+b&r=a%20b&z=#Intent;")).toBe(true);
  });
});

describe("buildBrowserEscapeIntent", () => {
  it("is an https VIEW intent for the same URL", () => {
    expect(buildBrowserEscapeIntent({ host: "example.com", pathname: "/p/1", search: "?x=1" })).toBe(
      "intent://example.com/p/1?x=1#Intent;scheme=https;action=android.intent.action.VIEW;end",
    );
  });
});

describe("toRuntimeConfig", () => {
  const full = resolved({
    domains: ["example.com", "www.example.com"],
    paths: ["/property/*", "!/admin/*"],
    apps: {
      ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
      android: {
        packageName: "com.example.app",
        sha256CertFingerprints: [FP],
        scheme: "exampleapp",
        stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
      },
      windows: {
        packageFamilyName: "Example_abc123xyz",
        storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
      },
    },
    web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
  });

  it("keeps what the browser needs and drops what only the generator needs", () => {
    const rc = toRuntimeConfig(full);
    expect(rc.hosts).toEqual(["example.com", "www.example.com"]);
    expect(rc.paths).toEqual({ include: ["/property/*"], exclude: ["/admin/*"] });
    expect(rc.apps.ios).toEqual({ storeUrl: "https://apps.apple.com/app/id123456789" });
    expect(rc.apps.android?.pkg).toBe("com.example.app");
    expect(rc.apps.android?.scheme).toBe("exampleapp");
    expect(JSON.stringify(rc)).not.toContain(FP);
    expect(JSON.stringify(rc)).not.toContain("ABCDE12345");
    expect(JSON.stringify(rc)).not.toContain("Example_abc123xyz");
  });

  it("maps behavior to the short runtime names", () => {
    expect(toRuntimeConfig(full).behavior).toEqual({
      redirect: true,
      delayMs: 0,
      inAppEscape: true,
      bots: true,
      guardParam: "dl_skip",
    });
  });

  it("turns the redirect switches into what the browser checks", () => {
    const rc = toRuntimeConfig(
      resolved({
        domains: ["example.com"],
        behavior: { redirect: false, redirectInAppBrowsers: true, redirectBots: true, skipParam: "nodl" },
      }),
    );
    expect(rc.behavior).toEqual({
      redirect: false,
      delayMs: 0,
      inAppEscape: false,
      bots: false,
      guardParam: "nodl",
    });
  });

  it("keeps the Android stores in the order written, as the priority", () => {
    const rc = toRuntimeConfig(
      resolved({
        domains: ["example.com"],
        apps: {
          android: {
            stores: {
              samsung: "https://galaxystore.samsung.com/detail/a.b",
              google: "https://play.google.com/store/apps/details?id=a.b",
            },
          },
        },
      }),
    );
    expect(rc.apps.android?.priority).toEqual(["samsung", "google"]);
  });

  it("has no web target without a web URL, even with routes", () => {
    const rc = toRuntimeConfig(
      resolved({ domains: ["example.com"], web: { routes: [{ from: "/a", to: "/b" }] } }),
    );
    expect(rc.web).toBeUndefined();
  });

  it("has no undefined values, so its JSON is stable", () => {
    const rc = toRuntimeConfig(resolved({ domains: ["example.com"] }));
    expect(JSON.stringify(rc)).toBe(JSON.stringify(JSON.parse(JSON.stringify(rc))));
    expect(rc.apps).toEqual({});
    expect(rc.web).toBeUndefined();
  });
});

describe("toRuntimeConfig: routing rules", () => {
  const rules = [
    { from: "/property/:propertyId/leads?id=:leadId", to: "/property/leads?lead=:leadId&p=:propertyId" },
    { from: "/app", to: null },
  ];
  const withRules = (routes: unknown) =>
    toRuntimeConfig(resolved({ domains: ["example.com"], web: { url: "https://app.example.com", routes } }));

  it("compiles them, so the browser only runs them", () => {
    expect(withRules(rules).web?.routes).toEqual([
      {
        p: "^/property/([^/]+)/leads(/?)$",
        q: [["id", "^([^]+)$"]],
        t: ["/property/leads?lead=", 1, "&p=", 0],
      },
      { p: "^/app(/?)$", t: null, k: 1 },
    ]);
  });

  it("leaves nothing for no rules", () => {
    expect(withRules(undefined).web?.routes).toBeUndefined();
    expect(withRules([]).web?.routes).toBeUndefined();
  });

  it("changes the config hash when a rule changes, so verify notices a stale deeplinker.js", () => {
    const other = [
      { from: "/property/:propertyId/leads?id=:leadId", to: "/property/leads?lead=:propertyId&p=:leadId" },
    ];
    expect(configHash(withRules(rules))).not.toBe(configHash(withRules(other)));
  });
});

describe("toRuntimeConfig: deferred deep linking", () => {
  const on = (deferred: Record<string, unknown>) =>
    toRuntimeConfig(
      resolved({
        domains: ["example.com"],
        apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } },
        deferred,
      }),
    );

  it("is absent when switched off", () => {
    expect(toRuntimeConfig(resolved({ domains: ["example.com"] })).deferred).toBeUndefined();
    expect(on({ enabled: false }).deferred).toBeUndefined();
  });

  it("points the click beacon at the configured path", () => {
    expect(on({ enabled: true }).deferred).toEqual({ url: "/dl/click" });
    expect(on({ enabled: true, basePath: "/api/links" }).deferred).toEqual({ url: "/api/links/click" });
  });

  it("leaves the clipboard method to the endpoint: the browser is told nothing about it", () => {
    expect(on({ enabled: true, clipboard: true }).deferred).toEqual({ url: "/dl/click" });
  });

  it("changes the hash, so verify notices a runtime built for different settings", () => {
    expect(configHash(on({ enabled: true }))).not.toBe(configHash(on({ enabled: false })));
  });
});

describe("configHash", () => {
  const base = resolved({
    domains: ["example.com"],
    apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } },
  });

  it("is 14 lower-case hex characters", () => {
    expect(configHash(toRuntimeConfig(base))).toMatch(/^[0-9a-f]{14}$/);
  });

  it("is stable across key order", () => {
    const rc = toRuntimeConfig(base);
    const shuffled = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(rc).reverse())));
    expect(configHash(shuffled)).toBe(configHash(rc));
  });

  it("changes when a store URL changes", () => {
    const other = resolved({
      domains: ["example.com"],
      apps: { ios: { storeUrl: "https://apps.apple.com/app/id2" } },
    });
    expect(configHash(toRuntimeConfig(other))).not.toBe(configHash(toRuntimeConfig(base)));
  });

  it("changes when a path rule changes", () => {
    const other = resolved({
      domains: ["example.com"],
      apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } },
      paths: ["/x/*"],
    });
    expect(configHash(toRuntimeConfig(other))).not.toBe(configHash(toRuntimeConfig(base)));
  });
});
