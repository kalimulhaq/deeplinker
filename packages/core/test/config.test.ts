import { describe, expect, it } from "vitest";
import { defineConfig, formatIssues, parseConfig } from "../src/index";

const REAL_FP =
  "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90";
const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

function ok(input: unknown) {
  const r = parseConfig(input);
  if (!r.ok) throw new Error("expected ok, got:\n" + formatIssues(r.errors));
  return r;
}

function fail(input: unknown) {
  const r = parseConfig(input);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
}

describe("parseConfig: accepting", () => {
  it("accepts a config with only domains", () => {
    const { config } = ok({ domains: ["example.com"] });
    expect(config.domains).toEqual(["example.com"]);
  });

  it("applies every documented default", () => {
    const { config } = ok({ domains: ["example.com"] });
    expect(config.behavior).toEqual({
      redirect: true,
      redirectDelayMs: 0,
      redirectInAppBrowsers: false,
      redirectBots: false,
      skipParam: "dl_skip",
    });
    expect(config.hosting).toBe("auto");
    expect(config.outDir).toBe("deeplinker-dist");
    expect(config.deferred.enabled).toBe(false);
    expect(config.debug).toBe(false);
  });

  it("applies per-app defaults when the app is present", () => {
    const { config } = ok({
      domains: ["example.com"],
      apps: {
        ios: { appIds: ["ABCDE12345.com.example.app"] },
        android: { packageName: "com.example.app", sha256CertFingerprints: [FP] },
        chromeos: {},
      },
      web: { pwa: {} },
    });
    expect(config.apps.android?.dynamicAppLinkComponents).toBe(true);
    expect(config.apps.chromeos?.useAndroidApp).toBe(true);
    expect(config.web?.pwa).toEqual({
      manifestPath: "/manifest.json",
      handleLinks: "auto",
      preferRelatedApplications: false,
    });
  });

  it("accepts the full config example once placeholders are real values", () => {
    const { config, warnings } = ok({
      domains: ["example.com", "www.example.com"],
      paths: ["/property/*", "/listing/*", "!/admin/*"],
      apps: {
        ios: {
          appIds: ["K7ZP4W2Q9X.com.example.app"],
          storeUrl: "https://apps.apple.com/app/id123456789",
          appClip: undefined,
        },
        android: {
          packageName: "com.example.app",
          sha256CertFingerprints: [REAL_FP],
          scheme: "exampleapp",
          stores: {
            google: "https://play.google.com/store/apps/details?id=com.example.app",
            huawei: "https://appgallery.huawei.com/app/C123",
            samsung: "https://galaxystore.samsung.com/detail/com.example.app",
            amazon: "https://www.amazon.com/gp/mas/dl/android?p=com.example.app",
            xiaomi: "https://app.mi.com/details?id=com.example.app",
          },
        },
        macos: { appIds: ["K7ZP4W2Q9X.com.example.mac"], storeUrl: "macappstore://apps.apple.com/app/id123" },
        windows: {
          packageFamilyName: "Example_abc123xyz",
          storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
        },
        linux: { scheme: "exampleapp", stores: { flathub: "https://flathub.org/apps/com.example.app" } },
        chromeos: { useAndroidApp: true },
      },
      web: {
        url: "https://app.example.com",
        routes: [{ from: "/property/:id", to: "/p/:id" }],
        pwa: { manifestPath: "/manifest.json", handleLinks: "preferred" },
      },
      behavior: { redirect: true, redirectDelayMs: 0 },
      deferred: { enabled: false },
      hosting: "auto",
      outDir: "deeplinker-dist",
    });
    expect(config.domains).toEqual(["example.com", "www.example.com"]);
    expect(config.paths).toEqual({ include: ["/property/*", "/listing/*"], exclude: ["/admin/*"] });
    expect(warnings).toEqual([]);
  });

  it("defineConfig returns its argument unchanged", () => {
    const c = { domains: ["example.com"] };
    expect(defineConfig(c)).toBe(c);
  });
});

describe("parseConfig: domains", () => {
  it('rejects "https://Example.com/" with path, message and example', () => {
    const [issue] = fail({ domains: ["https://Example.com/"] });
    expect(issue?.path).toBe("domains[0]");
    expect(issue?.message).toContain("is a URL");
    expect(issue?.example).toBe('domains: ["www.example.com", "m.example.com"]');
  });

  it("rejects a host name with a port or a path", () => {
    expect(fail({ domains: ["example.com:8080"] })[0]?.message).toContain("port");
    expect(fail({ domains: ["example.com/path"] })[0]?.message).toContain("path");
  });

  it("rejects a bare single label such as localhost", () => {
    expect(fail({ domains: ["localhost"] })[0]?.message).toContain("not a valid host name");
  });

  it("lower-cases, strips a trailing dot, and punycodes IDN host names", () => {
    expect(ok({ domains: ["EXAMPLE.com.", "Bücher.example", "例え.jp"] }).config.domains).toEqual([
      "example.com",
      "xn--bcher-kva.example",
      "xn--r8jz45g.jp",
    ]);
  });

  it("drops repeats once normalised, keeping the first", () => {
    const { config } = ok({ domains: ["example.com", "EXAMPLE.com", "www.example.com"] });
    expect(config.domains).toEqual(["example.com", "www.example.com"]);
  });

  it("requires at least one host name", () => {
    const [missing] = fail({});
    expect(missing?.path).toBe("domains");
    expect(missing?.example).toBe('domains: ["example.com"]');
    expect(fail({ domains: [] })[0]?.message).toContain("at least one");
  });

  it("says a single string must be a list", () => {
    const [issue] = fail({ domains: "example.com" });
    expect(issue?.path).toBe("domains");
    expect(issue?.message).toContain("list of host names");
  });

  it("names the old domain and additionalDomains keys as unknown", () => {
    const errors = fail({ domains: ["example.com"], domain: "example.com", additionalDomains: [] });
    expect(errors.map((e) => e.path).sort()).toEqual(["additionalDomains", "domain"]);
  });
});

describe("parseConfig: field validation", () => {
  it("normalises lower-case colon-less fingerprints", () => {
    const raw = FP.replaceAll(":", "").toLowerCase();
    const { config } = ok({
      domains: ["example.com"],
      apps: { android: { packageName: "com.example.app", sha256CertFingerprints: [raw] } },
    });
    expect(config.apps.android?.sha256CertFingerprints).toEqual([FP]);
  });

  it("rejects a 31-byte fingerprint with an example", () => {
    const short = FP.split(":").slice(0, 31).join(":");
    const [issue] = fail({
      domains: ["example.com"],
      apps: { android: { packageName: "com.example.app", sha256CertFingerprints: [short] } },
    });
    expect(issue?.path).toBe("apps.android.sha256CertFingerprints[0]");
    expect(issue?.message).toContain("32 bytes");
    expect(issue?.example).toContain("14:6D:E9");
  });

  it("rejects the AA:BB:... placeholder", () => {
    const [issue] = fail({
      domains: ["example.com"],
      apps: { android: { packageName: "com.example.app", sha256CertFingerprints: ["AA:BB:..."] } },
    });
    expect(issue?.path).toBe("apps.android.sha256CertFingerprints[0]");
  });

  it("rejects storeUrl that is not a URL", () => {
    const [issue] = fail({ domains: ["example.com"], apps: { ios: { storeUrl: "apps.apple.com/app/id1" } } });
    expect(issue?.path).toBe("apps.ios.storeUrl");
    expect(issue?.example).toContain("https://apps.apple.com");
  });

  it("accepts store-app schemes for store URLs", () => {
    ok({
      domains: ["example.com"],
      apps: {
        macos: { storeUrl: "macappstore://apps.apple.com/app/id123" },
        windows: { storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1" },
      },
    });
  });

  it("rejects paths that do not start with a slash, with an example", () => {
    const [issue] = fail({ domains: ["example.com"], paths: ["/ok/*", "property/*"] });
    expect(issue?.path).toBe("paths[1]");
    expect(issue?.message).toContain('must start with "/"');
    expect(issue?.example).toContain("/property/*");
    expect(fail({ domains: ["example.com"], paths: ["!admin"] })[0]?.path).toBe("paths[0]");
  });

  it("reads one list into include and exclude rules, with query and fragment", () => {
    const { config } = ok({
      domains: ["example.com"],
      paths: ["/property/*", "/search?q=*&ref", "/promo/*#open", "!/admin/*", "!/search?debug=1"],
    });
    expect(config.paths).toEqual({
      include: [
        "/property/*",
        { path: "/search", query: { q: "*", ref: "*" } },
        { path: "/promo/*", fragment: "open" },
      ],
      exclude: ["/admin/*", { path: "/search", query: { debug: "1" } }],
    });
  });

  it("leaves out the side of paths that has no entries", () => {
    expect(ok({ domains: ["example.com"], paths: ["!/admin/*"] }).config.paths).toEqual({
      exclude: ["/admin/*"],
    });
    expect(ok({ domains: ["example.com"], paths: [] }).config.paths).toEqual({});
  });

  it.each([
    ["/search?q=?", 'second "?"'],
    ["/search?", 'nothing after "?"'],
    ["/promo#", 'nothing after "#"'],
    ["/search?=x", "empty query parameter name"],
  ])("rejects %j", (entry, message) => {
    const [issue] = fail({ domains: ["example.com"], paths: [entry] });
    expect(issue?.path).toBe("paths[0]");
    expect(issue?.message).toContain(message);
  });

  it("rejects the old include/exclude object", () => {
    expect(fail({ domains: ["example.com"], paths: { include: ["/a"] } })[0]?.path).toBe("paths");
  });

  it("keeps the Android stores in the order they are written, which is the preference", () => {
    const stores = {
      samsung: "https://galaxystore.samsung.com/detail/com.example.app",
      google: "https://play.google.com/store/apps/details?id=com.example.app",
      huawei: "https://appgallery.huawei.com/app/C1",
    };
    const { config } = ok({ domains: ["example.com"], apps: { android: { stores } } });
    expect(Object.keys(config.apps.android?.stores ?? {})).toEqual(["samsung", "google", "huawei"]);
  });

  it("rejects an unknown Android store and a store link that is not a URL", () => {
    const errors = fail({
      domains: ["example.com"],
      apps: { android: { stores: { fdroid: "https://f-droid.org/x", google: "play" } } },
    });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "apps.android.stores.fdroid",
      "apps.android.stores.google",
    ]);
    expect(errors.find((e) => e.path.endsWith("fdroid"))?.message).toContain("Unknown store");
  });

  it("rejects routes rules whose from does not start with a slash", () => {
    const [issue] = fail({
      domains: ["example.com"],
      web: { routes: [{ from: "property/:id", to: "/p/:id" }] },
    });
    expect(issue?.path).toBe("web.routes[0].from");
  });

  it("rejects an invalid enum value and names the options", () => {
    const [issue] = fail({ domains: ["example.com"], hosting: "heroku" });
    expect(issue?.path).toBe("hosting");
    expect(issue?.message).toContain("vercel");
    expect(issue?.example).toBe('hosting: "auto"');
  });

  it("rejects a non-boolean behavior switch with an example", () => {
    const [issue] = fail({ domains: ["example.com"], behavior: { redirect: "yes" } });
    expect(issue?.path).toBe("behavior.redirect");
    expect(issue?.example).toBe("redirect: true");
  });

  it("rejects unknown keys with a did-you-mean", () => {
    const [issue] = fail({ domains: ["example.com"], behaviour: { redirect: true } });
    expect(issue?.path).toBe("behaviour");
    expect(issue?.message).toContain('did you mean "behavior"');
  });

  it.each([
    ["behavior", { mode: "auto" }],
    ["behavior", { showOpenInAppButton: true }],
    ["behavior", { inAppBrowserEscape: true }],
    ["behavior", { respectBots: true }],
    ["apps.ios", { smartBanner: true }],
    ["apps.ios", { appStoreId: "123" }],
    ["apps.android", { storePriority: ["google"] }],
  ])("names the removed key %s.%j as unknown", (where, value) => {
    const [section, app] = where.split(".");
    const input = app ? { apps: { [app]: value } } : { [section as string]: value };
    const errors = fail({ domains: ["example.com"], ...input });
    expect(errors.map((e) => e.path)).toEqual([`${where}.${Object.keys(value)[0]}`]);
  });

  it("names the removed ui key as unknown", () => {
    expect(fail({ domains: ["example.com"], ui: { theme: "dark" } }).map((e) => e.path)).toEqual(["ui"]);
  });

  it("collects every issue instead of stopping at the first", () => {
    const errors = fail({ domains: ["https://x.com"], outDir: 5, behavior: { redirectDelayMs: -1 } });
    expect(errors.map((e) => e.path).sort()).toEqual(["behavior.redirectDelayMs", "domains[0]", "outDir"]);
  });

  it("rejects a non-object config", () => {
    expect(fail("example.com")[0]?.message).toContain("must be an object");
    expect(fail(null)[0]?.message).toContain("must be an object");
  });
});

describe("formatIssues", () => {
  it("prints path, message and example for each issue", () => {
    const text = formatIssues(fail({ domains: ["https://Example.com/"] }));
    expect(text).toContain("domains[0]");
    expect(text).toContain("is a URL");
    expect(text).toContain('e.g. domains: ["www.example.com", "m.example.com"]');
  });
});

describe("parseConfig: warnings", () => {
  it("warns on lowercase productid in a Windows store URL", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: { windows: { storeUrl: "ms-windows-store://pdp/?productid=9NBLGGH4NNS1" } },
    });
    expect(warnings.join("\n")).toContain("ProductId");
  });

  it("warns when a Team ID is not 10 alphanumeric characters", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: { ios: { appIds: ["TEAMID.com.example.app"] } },
    });
    expect(warnings.join("\n")).toContain("Team ID");
  });

  it("warns that assetlinks.json will be skipped without fingerprints", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: { android: { packageName: "com.example.app" } },
    });
    expect(warnings.join("\n")).toContain("sha256CertFingerprints");
  });

  it("warns when the Play store URL already carries a referrer", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: {
        android: { stores: { google: "https://play.google.com/store/apps/details?id=a.b&referrer=x" } },
      },
    });
    expect(warnings.join("\n")).toContain("referrer");
  });

  it("warns when the ChromeOS app is enabled without an Android app", () => {
    const { warnings } = ok({ domains: ["example.com"], apps: { chromeos: { useAndroidApp: true } } });
    expect(warnings.join("\n")).toContain("chromeos");
  });
});

describe("parseConfig: placeholder warnings", () => {
  it("warns about Apple's documentation Team ID, for iOS and macOS", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: {
        ios: { appIds: ["ABCDE12345.com.example.app"] },
        macos: { appIds: ["ABCDE12345.com.example.mac"] },
      },
    });
    expect(warnings.filter((w) => w.includes("Apple's documentation"))).toHaveLength(2);
  });

  it("warns about the documentation fingerprint, including on additional apps", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: {
        android: {
          packageName: "com.example.app",
          sha256CertFingerprints: [REAL_FP],
          otherApps: [{ packageName: "com.example.beta", sha256CertFingerprints: [FP] }],
        },
      },
    });
    expect(warnings.join("\n")).toContain("sample fingerprint");
  });

  it("is quiet for real values", () => {
    const { warnings } = ok({
      domains: ["example.com"],
      apps: {
        ios: { appIds: ["K7ZP4W2Q9X.com.example.app"] },
        android: { packageName: "com.example.app", sha256CertFingerprints: [REAL_FP] },
      },
    });
    expect(warnings.filter((w) => /sample|documentation/.test(w))).toEqual([]);
  });
});

describe("parseConfig: deferred deep linking", () => {
  it("is off by default, with documented defaults when switched on", () => {
    expect(ok({ domains: ["example.com"] }).config.deferred).toEqual({
      enabled: false,
      ttlSeconds: 3600,
      basePath: "/dl",
      clipboard: false,
    });
    expect(ok({ domains: ["example.com"], deferred: { enabled: true } }).config.deferred).toEqual({
      enabled: true,
      ttlSeconds: 3600,
      basePath: "/dl",
      clipboard: false,
    });
  });

  it("leaves storage unset so the host can choose its default", () => {
    expect(
      ok({ domains: ["example.com"], deferred: { enabled: true } }).config.deferred.storage,
    ).toBeUndefined();
    expect(
      ok({ domains: ["example.com"], deferred: { enabled: true, storage: "redis" } }).config.deferred.storage,
    ).toBe("redis");
  });

  it("rejects an unknown storage, a short ttl and a base path without a slash, with examples", () => {
    const errors = fail({
      domains: ["example.com"],
      deferred: { storage: "mongo", ttlSeconds: 5, basePath: "dl" },
    });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "deferred.basePath",
      "deferred.storage",
      "deferred.ttlSeconds",
    ]);
  });

  it.each(["/dl", "/api/links", "/a.b/c_d-e~f", "/v2/dl"])("accepts the base path %s", (basePath) => {
    expect(ok({ domains: ["example.com"], deferred: { basePath } }).config.deferred.basePath).toBe(basePath);
  });

  it.each([
    "dl",
    "/",
    "/dl/",
    "//dl",
    "/a//b",
    "/dl/../x",
    "/./dl",
    "/dl?x=1",
    "/dl#x",
    "/d l",
    "/dl'; exit; '",
    "/dl\nlocation",
    "/dl{",
    "/dl;",
    "/.well-known/dl",
  ])("rejects the base path %j, which cannot be written safely into server config", (basePath) => {
    expect(fail({ domains: ["example.com"], deferred: { basePath } }).map((e) => e.path)).toEqual([
      "deferred.basePath",
    ]);
  });

  it("warns when it is on but nothing sends anyone to a store, and when clipboard is set while it is off", () => {
    expect(ok({ domains: ["example.com"], deferred: { enabled: true } }).warnings.join()).toContain(
      "no app has a store URL",
    );
    const withStore = {
      domains: ["example.com"],
      apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } },
      deferred: { enabled: true },
    };
    expect(ok(withStore).warnings.filter((w) => w.includes("store URL"))).toEqual([]);
    expect(ok({ domains: ["example.com"], deferred: { clipboard: true } }).warnings.join()).toContain(
      "no effect",
    );
  });
});

describe("parseConfig: routing rules", () => {
  const web = (routes: unknown) => ({
    domains: ["example.com"],
    web: { url: "https://app.example.com", routes },
  });

  it("accepts rules that read and write the path, the query and the fragment, and a rule with no target", () => {
    const rules = [
      { from: "/property/:propertyId/leads?id=:leadId", to: "/property/leads?lead=:leadId&p=:propertyId" },
      { from: "/app?lead=:id", to: "/applicants#:id" },
      { from: "/files/*", to: "/dl/*" },
      { from: "/app", to: null },
    ];
    expect(ok(web(rules)).config.web?.routes).toEqual(rules);
  });

  it("says which half of the rule is wrong, with a problem you can act on and an example", () => {
    const errors = fail(web([{ from: "/property/:propertyId/leads?id=:leadId", to: "/p/:id" }]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: "web.routes[0].to" });
    expect(errors[0]?.message).toBe(":id is not captured by from (the captures are :propertyId, :leadId).");
    expect(errors[0]?.example).toBe('to: "/p/:id"');
  });

  it("reports each problem against from or to", () => {
    const errors = fail(
      web([
        { from: "x/:id", to: "y" },
        { from: "/a/:id?q=:id", to: "/b" },
      ]),
    );
    expect(errors.map((e) => [e.path, e.message])).toEqual([
      ["web.routes[0].from", '"x/:id" must start with "/".'],
      ["web.routes[0].to", '"y" must start with "/".'],
      ["web.routes[1].from", ":id appears twice; give each capture its own name."],
    ]);
  });

  it("rejects a capture name that does not start with a letter, on either side", () => {
    expect(fail(web([{ from: "/p/:1", to: "/x" }])).map((e) => [e.path, e.message])).toEqual([
      ["web.routes[0].from", expect.stringContaining(":1 is not a name")],
    ]);
    expect(fail(web([{ from: "/p/:id", to: "/x/:2" }]))[0]?.path).toBe("web.routes[0].to");
  });

  it("rejects the old shape's extra keys, and a non-string target", () => {
    expect(fail(web([{ from: "/a", to: "/b", query: ["x"] }]))[0]?.path).toBe("web.routes[0].query");
    expect(fail(web([{ from: "/a", to: 5 }]))[0]?.path).toBe("web.routes[0].to");
  });
});
