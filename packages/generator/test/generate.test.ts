import { configHash, toRuntimeConfig } from "@deeplinker/core";
import { describe, expect, it } from "vitest";
import { generate } from "../src/generate";
import { FP, resolved } from "./helpers";

const TEMPLATE = 'var __c = "__DEEPLINKER_CONFIG__";';
const full = () =>
  resolved({
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
      linux: { scheme: "exampleapp", stores: { flathub: "https://flathub.org/apps/com.example.app" } },
    },
    web: {
      url: "https://app.example.com",
      routes: [{ from: "/property/:id", to: "/p/:id" }],
      pwa: { handleLinks: "preferred" },
    },
    hosting: "apache",
  });

const run = (c = full(), opts = {}) => generate(c, { runtimeTemplate: TEMPLATE, ...opts });
const get = (r: ReturnType<typeof run>, path: string) => r.files.find((f) => f.path === path);

describe("generate()", () => {
  it("emits every documented output file for a full config", () => {
    expect(run().files.map((f) => f.path)).toEqual([
      ".well-known/apple-app-site-association",
      ".well-known/assetlinks.json",
      ".well-known/windows-app-web-link",
      "manifest.fragment.json",
      "deeplinker.js",
      "snippet.html",
      ".htaccess",
      "README-DEPLOY.md",
      "app-snippets.md",
    ]);
  });

  it("emits only what the config needs for a domain-only config", () => {
    const r = run(resolved({}));
    expect(r.files.map((f) => f.path)).toEqual(["deeplinker.js", "snippet.html", "README-DEPLOY.md"]);
  });

  it("gives every file a one-line description", () => {
    for (const f of run().files) expect(f.description, f.path).toMatch(/^\S.*$/);
  });

  it("is deterministic", () => {
    expect(run()).toEqual(run());
  });

  it("writes JSON files as two-space JSON with a trailing newline", () => {
    const aasa = get(run(), ".well-known/apple-app-site-association")?.content ?? "";
    expect(aasa.endsWith("}\n")).toBe(true);
    expect(JSON.parse(aasa).applinks.details[0].appIDs).toEqual(["ABCDE12345.com.example.app"]);
    expect(aasa).toContain('\n  "applinks"');
  });

  it("collects warnings from the builders", () => {
    const c = resolved({
      apps: { windows: { packageFamilyName: "Example_abc123xyz" } },
      paths: ["/p/*?x=1"],
    });
    const r = run(c);
    expect(r.warnings.join("\n")).toContain("windows");
    expect(get(r, "README-DEPLOY.md")?.content).toContain("windows");
  });
});

describe("deeplinker.js", () => {
  it("is the template with the runtime config inlined and no placeholder left", () => {
    const r = run();
    const js = get(r, "deeplinker.js")?.content ?? "";
    expect(js).not.toContain("__DEEPLINKER_CONFIG__");
    const inlined = JSON.stringify(toRuntimeConfig(full()));
    expect(js).toContain(`var __c = ${inlined};`);
  });

  it("starts with a banner carrying the config hash that `verify` compares", () => {
    const r = run();
    const hash = configHash(toRuntimeConfig(full()));
    expect(r.hash).toBe(hash);
    expect(
      get(r, "deeplinker.js")?.content.startsWith(`/*! @kalimulhaq/deeplinker config:${hash} */\n`),
    ).toBe(true);
  });

  it("the hash changes when the config changes", () => {
    const other = resolved({ apps: { ios: { storeUrl: "https://apps.apple.com/app/id2" } } });
    expect(run(other).hash).not.toBe(
      run(resolved({ apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } } })).hash,
    );
  });

  it("a template without the placeholder is reported, not silently shipped", () => {
    const r = generate(full(), { runtimeTemplate: "console.log(1)" });
    expect(r.warnings.join("\n")).toContain("placeholder");
  });

  it("an empty template (runtime not built) is reported", () => {
    const r = generate(full(), { runtimeTemplate: "" });
    expect(r.warnings.join("\n")).toContain("runtime");
  });

  it("is safe to put in a script tag: the JSON never contains </script", () => {
    const c = resolved({ web: { url: "https://app.example.com/a</script>b" } });
    expect(get(run(c), "deeplinker.js")?.content).not.toContain("</script");
  });
});

describe("snippet.html", () => {
  it("is the script tag and nothing else that reaches the page", () => {
    const html = get(run(), "snippet.html")?.content ?? "";
    expect(html).toContain('<script src="/deeplinker.js" async></script>');
    // Comments aside, the only element is the script: deeplinker adds nothing visible to a page.
    expect(html.replace(/<!--[^]*?-->/g, "").trim()).toBe('<script src="/deeplinker.js" async></script>');
    expect(html).not.toContain("apple-itunes-app");
  });
});

describe("manifest", () => {
  it("writes a fragment when the project has no manifest", () => {
    const f = get(run(), "manifest.fragment.json");
    expect(f?.before).toBeUndefined();
    expect(JSON.parse(f?.content ?? "")).toMatchObject({
      handle_links: "preferred",
      prefer_related_applications: false,
    });
  });

  it("merges into an existing manifest at its own path and keeps the user's fields", () => {
    const existing = JSON.stringify({ name: "Example", start_url: "/", handle_links: "not-preferred" });
    const r = run(full(), { existing: { manifest: existing } });
    const f = get(r, "manifest.json");
    expect(get(r, "manifest.fragment.json")).toBeUndefined();
    expect(f?.before).toBe(existing);
    const merged = JSON.parse(f?.content ?? "");
    expect(merged.name).toBe("Example");
    expect(merged.handle_links).toBe("not-preferred");
    expect(merged.related_applications).toHaveLength(2);
    expect(r.notes.join("\n")).toContain("handle_links");
  });

  it("uses web.pwa.manifestPath for the merged file", () => {
    const c = resolved({
      apps: {
        android: {
          packageName: "com.example.app",
          sha256CertFingerprints: [FP],
          stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
        },
      },
      web: { pwa: { manifestPath: "/static/site.webmanifest" } },
    });
    expect(get(run(c, { existing: { manifest: "{}" } }), "static/site.webmanifest")).toBeDefined();
  });

  it("an existing manifest that is not valid JSON is reported and not touched", () => {
    const r = run(full(), { existing: { manifest: "{ nope" } });
    expect(r.warnings.join("\n")).toContain("manifest");
    expect(get(r, "manifest.fragment.json")).toBeDefined();
  });
});

describe("README-DEPLOY.md", () => {
  const readme = () => get(run(), "README-DEPLOY.md")?.content ?? "";

  it("lists each generated file with where it goes", () => {
    const text = readme();
    for (const path of [
      ".well-known/apple-app-site-association",
      ".well-known/assetlinks.json",
      ".well-known/windows-app-web-link",
      "deeplinker.js",
      ".htaccess",
    ]) {
      expect(text, path).toContain(path);
    }
    expect(text).toContain("https://example.com/.well-known/apple-app-site-association");
  });

  it("names every domain, because every one needs the same files", () => {
    const text = readme();
    expect(text).toContain("example.com");
    expect(text).toContain("www.example.com");
  });

  it("ends with the verify command for this domain", () => {
    expect(readme()).toContain("npx deeplinker verify https://example.com");
  });

  it("says which host it was written for", () => {
    expect(readme().toLowerCase()).toContain("apache");
  });

  it("carries the config warnings", () => {
    const c = resolved({
      apps: { windows: { packageFamilyName: "Example_abc123xyz" } },
      paths: ["/p/*?x=1"],
    });
    expect(get(run(c), "README-DEPLOY.md")?.content).toContain("query");
  });
});
