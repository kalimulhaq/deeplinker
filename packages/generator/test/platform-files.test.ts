import { describe, expect, it } from "vitest";
import { buildAasa } from "../src/files/aasa";
import { buildAssetlinks } from "../src/files/assetlinks";
import { buildWindowsLink } from "../src/files/windows";
import { FP, FP2, resolved } from "./helpers";

const IOS = { appIds: ["ABCDE12345.com.example.app"] };
const ANDROID = { packageName: "com.example.app", sha256CertFingerprints: [FP] };

describe("apple-app-site-association", () => {
  it("uses appIDs and components, never appID or paths", () => {
    const aasa = buildAasa(resolved({ apps: { ios: IOS }, paths: ["/property/*"] })).value as any;
    expect(aasa).toEqual({
      applinks: {
        details: [{ appIDs: ["ABCDE12345.com.example.app"], components: [{ "/": "/property/*" }] }],
      },
    });
    const text = JSON.stringify(aasa);
    expect(text).not.toContain('"appID"');
    expect(text).not.toContain('"paths"');
  });

  it("puts excludes before includes, because the first matching component wins", () => {
    const aasa = buildAasa(resolved({ apps: { ios: IOS }, paths: ["/property/*", "!/property/private/*"] }))
      .value as any;
    expect(aasa.applinks.details[0].components).toEqual([
      { "/": "/property/private/*", exclude: true },
      { "/": "/property/*" },
    ]);
  });

  it("matches everything when no paths are configured", () => {
    const aasa = buildAasa(resolved({ apps: { ios: IOS } })).value as any;
    expect(aasa.applinks.details[0].components).toEqual([{ "/": "*" }]);
  });

  it("with only excludes, ends with a catch-all so everything else still opens the app", () => {
    const aasa = buildAasa(resolved({ apps: { ios: IOS }, paths: ["!/admin/*"] })).value as any;
    expect(aasa.applinks.details[0].components).toEqual([{ "/": "/admin/*", exclude: true }, { "/": "*" }]);
  });

  it("turns a query dictionary into a ? dictionary", () => {
    const aasa = buildAasa(resolved({ apps: { ios: IOS }, paths: ["/p/*?ref=*"] })).value as any;
    expect(aasa.applinks.details[0].components).toEqual([{ "/": "/p/*", "?": { ref: "*" } }]);
  });

  it("turns a fragment into #", () => {
    const aasa = buildAasa(
      resolved({
        apps: { ios: IOS },
        paths: ["/abc?def=*#top"],
      }),
    ).value as any;
    expect(aasa.applinks.details[0].components).toEqual([{ "/": "/abc", "?": { def: "*" }, "#": "top" }]);
  });

  it("an exclude by fragment alone, on every path", () => {
    const aasa = buildAasa(resolved({ apps: { ios: IOS }, paths: ["!/*#no_universal_links"] })).value as any;
    expect(aasa.applinks.details[0].components[0]).toEqual({
      "/": "/*",
      "#": "no_universal_links",
      exclude: true,
    });
  });

  it("lists iOS and macOS app IDs together, once each", () => {
    const aasa = buildAasa(
      resolved({
        apps: {
          ios: { appIds: ["ABCDE12345.com.example.app", "ABCDE12345.com.example.two"] },
          macos: { appIds: ["ABCDE12345.com.example.mac", "ABCDE12345.com.example.app"] },
        },
      }),
    ).value as any;
    expect(aasa.applinks.details).toHaveLength(1);
    expect(aasa.applinks.details[0].appIDs).toEqual([
      "ABCDE12345.com.example.app",
      "ABCDE12345.com.example.two",
      "ABCDE12345.com.example.mac",
    ]);
  });

  it("adds appclips only when an App Clip is configured", () => {
    expect((buildAasa(resolved({ apps: { ios: IOS } })).value as any).appclips).toBeUndefined();
    const aasa = buildAasa(
      resolved({ apps: { ios: { ...IOS, appClip: "ABCDE12345.com.example.app.Clip" } } }),
    ).value as any;
    expect(aasa.appclips).toEqual({ apps: ["ABCDE12345.com.example.app.Clip"] });
  });

  it("an App Clip alone still produces a file", () => {
    const aasa = buildAasa(resolved({ apps: { ios: { appClip: "ABCDE12345.com.example.app.Clip" } } }))
      .value as any;
    expect(aasa).toEqual({ appclips: { apps: ["ABCDE12345.com.example.app.Clip"] } });
  });

  it("is null when no app ID is configured", () => {
    expect(buildAasa(resolved({})).value).toBeNull();
    expect(
      buildAasa(resolved({ apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } } })).value,
    ).toBeNull();
  });
});

describe("assetlinks.json", () => {
  const relation = "delegate_permission/common.handle_all_urls";

  it("lists every package and every fingerprint", () => {
    const links = buildAssetlinks(
      resolved({
        apps: {
          android: {
            packageName: "com.example.app",
            sha256CertFingerprints: [FP, FP2],
            otherApps: [{ packageName: "com.example.app.beta", sha256CertFingerprints: [FP2] }],
          },
        },
      }),
    ).value as any[];
    expect(links).toEqual([
      {
        relation: [relation],
        target: {
          namespace: "android_app",
          package_name: "com.example.app",
          sha256_cert_fingerprints: [FP, FP2],
        },
      },
      {
        relation: [relation],
        target: {
          namespace: "android_app",
          package_name: "com.example.app.beta",
          sha256_cert_fingerprints: [FP2],
        },
      },
    ]);
  });

  it("puts Android 15 dynamic rules inside the statement, with no comment key", () => {
    const links = buildAssetlinks(
      resolved({
        apps: { android: ANDROID },
        paths: ["/p/*?ref=*#x", "!/admin/*"],
      }),
    ).value as any[];
    expect(links).toHaveLength(1);
    expect(links[0].relation_extensions).toEqual({
      [relation]: {
        dynamic_app_link_components: [
          { "/": "/admin/*", exclude: true },
          { "/": "/p/*", "?": { ref: "*" }, "#": "x" },
        ],
      },
    });
    expect(JSON.stringify(links)).not.toContain('"comment"');
  });

  it("with only excludes, ends with a catch-all (no match means the URL does not open the app)", () => {
    const links = buildAssetlinks(resolved({ apps: { android: ANDROID }, paths: ["!/admin/*"] }))
      .value as any[];
    expect(links[0].relation_extensions[relation].dynamic_app_link_components).toEqual([
      { "/": "/admin/*", exclude: true },
      { "/": "*" },
    ]);
  });

  it("omits dynamic rules when no paths are configured or when switched off", () => {
    expect(
      (buildAssetlinks(resolved({ apps: { android: ANDROID } })).value as any[])[0].relation_extensions,
    ).toBeUndefined();
    const off = buildAssetlinks(
      resolved({
        apps: { android: { ...ANDROID, dynamicAppLinkComponents: false } },
        paths: ["/p/*"],
      }),
    ).value as any[];
    expect(off[0].relation_extensions).toBeUndefined();
  });

  it("is null without a package and fingerprints", () => {
    expect(buildAssetlinks(resolved({})).value).toBeNull();
    expect(
      buildAssetlinks(resolved({ apps: { android: { packageName: "com.example.app" } } })).value,
    ).toBeNull();
  });
});

describe("windows-app-web-link", () => {
  const win = { packageFamilyName: "Example_abc123xyz" };

  it("defaults to every path", () => {
    expect(buildWindowsLink(resolved({ apps: { windows: win } })).value).toEqual([
      { packageFamilyName: "Example_abc123xyz", paths: ["*"] },
    ]);
  });

  it("excludePaths mirror paths.exclude and paths mirror paths.include", () => {
    const built = buildWindowsLink(
      resolved({
        apps: { windows: win },
        paths: ["/property/*", "/listing/*", "!/admin/*"],
      }),
    );
    expect(built.value).toEqual([
      {
        packageFamilyName: "Example_abc123xyz",
        paths: ["/property/*", "/listing/*"],
        excludePaths: ["/admin/*"],
      },
    ]);
    expect(built.warnings).toEqual([]);
  });

  it("only adds allowSubdomains when asked", () => {
    const built = buildWindowsLink(resolved({ apps: { windows: { ...win, allowSubdomains: true } } }))
      .value as any[];
    expect(built[0].allowSubdomains).toBe(true);
  });

  it("warns when a query or fragment rule cannot be expressed, and never over-excludes", () => {
    const built = buildWindowsLink(
      resolved({
        apps: { windows: win },
        paths: ["/p/*?ref=*", "!/*?draft=1"],
      }),
    );
    expect(built.warnings.join("\n")).toContain("query");
    expect(built.value).toEqual([{ packageFamilyName: "Example_abc123xyz", paths: ["/p/*"] }]);
  });

  it("is null without a package family name", () => {
    expect(buildWindowsLink(resolved({})).value).toBeNull();
    expect(
      buildWindowsLink(resolved({ apps: { windows: { storeUrl: "ms-windows-store://pdp/?ProductId=9N" } } }))
        .value,
    ).toBeNull();
  });
});
