import { describe, expect, it } from "vitest";
import { renderAppSnippets, toAndroidPath } from "../src/files/app-snippets";
import { FP, resolved } from "./helpers";

const config = () =>
  resolved({
    domains: ["example.com", "www.example.com"],
    paths: ["/property/*", "/about", "!/admin/*"],
    apps: {
      ios: { appIds: ["ABCDE12345.com.example.app"], appClip: "ABCDE12345.com.example.app.Clip" },
      macos: { appIds: ["ABCDE12345.com.example.mac"] },
      android: { packageName: "com.example.app", sha256CertFingerprints: [FP], scheme: "exampleapp" },
      windows: { packageFamilyName: "Example_abc123xyz" },
      linux: { scheme: "exampleapp" },
    },
  });

const snippet = (platform: string) => renderAppSnippets(config()).find((s) => s.platform === platform);

describe("renderAppSnippets", () => {
  it("covers ios, macos, android, windows and linux, each with where it goes and how to read the URL", () => {
    const all = renderAppSnippets(config());
    expect(all.map((s) => s.platform)).toEqual(["ios", "macos", "android", "windows", "linux"]);
    for (const s of all) {
      expect(s.where, s.platform).not.toBe("");
      expect(s.readUrl, s.platform).not.toBe("");
      expect(s.code, s.platform).not.toBe("");
    }
  });

  it("prints only what the config has apps for", () => {
    expect(renderAppSnippets(resolved({}))).toEqual([]);
    expect(
      renderAppSnippets(resolved({ apps: { ios: { appIds: ["ABCDE12345.com.example.app"] } } })).map(
        (s) => s.platform,
      ),
    ).toEqual(["ios"]);
  });

  it("ios prints applinks: for every domain and appclips: for the Clip", () => {
    const code = snippet("ios")?.code ?? "";
    expect(code).toContain("applinks:example.com");
    expect(code).toContain("applinks:www.example.com");
    expect(code).toContain("appclips:example.com");
    expect(code).toContain("<key>com.apple.developer.associated-domains</key>");
  });

  it("macos prints applinks: for every domain", () => {
    const code = snippet("macos")?.code ?? "";
    expect(code).toContain("applinks:example.com");
    expect(code).toContain("applinks:www.example.com");
  });

  it("android has autoVerify and one data element per domain and path", () => {
    const code = snippet("android")?.code ?? "";
    expect(code).toContain('<intent-filter android:autoVerify="true">');
    expect(code).toContain('<action android:name="android.intent.action.VIEW" />');
    expect(code).toContain('<category android:name="android.intent.category.BROWSABLE" />');
    expect(code).toContain('<data android:scheme="https" android:host="example.com" />');
    expect(code).toContain('<data android:scheme="https" android:host="www.example.com" />');
    expect(code).toContain('<data android:pathPrefix="/property/" />');
    expect(code).toContain('<data android:path="/about" />');
  });

  it("android adds a second filter for the custom scheme and says excludes are not expressible", () => {
    const code = snippet("android")?.code ?? "";
    expect(code).toContain('<data android:scheme="exampleapp" android:host="example.com" />');
    expect(code).toMatch(/admin/);
    expect(snippet("android")?.notes.join(" ")).toContain("Android 15");
  });

  it("android without paths declares the host only", () => {
    const code =
      renderAppSnippets(
        resolved({ apps: { android: { packageName: "com.example.app", sha256CertFingerprints: [FP] } } }),
      )[0]?.code ?? "";
    expect(code).not.toContain("android:path");
  });

  it("windows declares the uap3 namespace and one Host per domain", () => {
    const code = snippet("windows")?.code ?? "";
    expect(code).toContain('xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"');
    expect(code).toContain('IgnorableNamespaces="uap uap3"');
    expect(code).toContain('<uap3:Extension Category="windows.appUriHandler">');
    expect(code).toContain('<uap3:Host Name="example.com" />');
    expect(code).toContain('<uap3:Host Name="www.example.com" />');
  });

  it("windows says browsers do not hand links to the app", () => {
    expect(snippet("windows")?.notes.join(" ")).toMatch(/Chrome|Firefox|browser/);
  });

  it("linux prints MimeType=x-scheme-handler/<scheme> and says there is no verified link", () => {
    const s = snippet("linux");
    expect(s?.code).toContain("MimeType=x-scheme-handler/exampleapp;");
    expect(s?.code).toContain("Exec=");
    expect(s?.notes.join(" ")).toMatch(/no verified|prompt/i);
  });

  it("each readUrl is one line", () => {
    for (const s of renderAppSnippets(config())) expect(s.readUrl, s.platform).not.toContain("\n");
  });

  it("android points at the Install Referrer for the original URL after a store install", () => {
    expect(snippet("android")?.notes.join(" ")).toContain("Install Referrer");
  });
});

describe("toAndroidPath follows Android's path semantics", () => {
  it.each([
    ["/about", { attr: "path", value: "/about" }],
    ["/property/*", { attr: "pathPrefix", value: "/property/" }],
    ["/*", { attr: "pathPrefix", value: "/" }],
    ["/v1.0/*", { attr: "pathPrefix", value: "/v1.0/" }],
    ["/a/*/edit", { attr: "pathPattern", value: "/a/.*/edit" }],
    ["/v1.0/*/x", { attr: "pathPattern", value: "/v1\\\\.0/.*/x" }],
    ["/p/?", { attr: "pathPattern", value: "/p/." }],
    ["/p/?*", { attr: "pathPattern", value: "/p/..*" }],
  ])("%s", (pattern, expected) => {
    expect(toAndroidPath(pattern)).toEqual(expected);
  });

  it("a match-everything pattern needs no path attribute", () => {
    expect(toAndroidPath("*")).toBeNull();
  });
});
