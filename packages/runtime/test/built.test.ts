import { parseConfig, toRuntimeConfig } from "@deeplinker/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dist = (name: string) => readFileSync(resolve(__dirname, "../dist", name), "utf8");
const gzipped = (text: string) => gzipSync(text, { level: 9 }).length;
const LIMIT = 6144;
const PLACEHOLDER = '"__DEEPLINKER_CONFIG__"';

const config = toRuntimeConfig(
  (() => {
    const r = parseConfig({
      domains: ["example.com", "www.example.com"],
      paths: ["/property/*", "/listing/*", "!/admin/*"],
      apps: {
        ios: { storeUrl: "https://apps.apple.com/app/id123456789" },
        android: {
          packageName: "com.example.app",
          scheme: "exampleapp",
          stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
        },
        windows: { storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1" },
      },
      web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.config;
  })(),
);

describe("the built files", () => {
  it("the IIFE and the UMD are each within the 6 KB min+gzip budget", () => {
    for (const file of ["deeplinker.iife.min.js", "deeplinker.umd.js"]) {
      const size = gzipped(dist(file));
      expect(size, `${file} is ${size} bytes gzipped`).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("reports what a deeplinker.js with a typical config weighs (the config adds to the runtime)", () => {
    const withConfig = dist("deeplinker.iife.min.js").replace(PLACEHOLDER, JSON.stringify(config));
    const size = gzipped(withConfig);
    console.log(
      `deeplinker.js with the reference config: ${size} bytes gzipped (runtime alone ${gzipped(dist("deeplinker.iife.min.js"))})`,
    );
    expect(size).toBeGreaterThan(gzipped(dist("deeplinker.iife.min.js")));
  });

  it("the IIFE contains the config placeholder exactly once", () => {
    expect(dist("deeplinker.iife.min.js").split(PLACEHOLDER)).toHaveLength(2);
  });

  it("uses no syntax newer than ES2015", () => {
    for (const file of ["deeplinker.iife.min.js", "deeplinker.umd.js"]) {
      const code = dist(file);
      expect(code, file).not.toMatch(/\?\.|\?\?|\.\.\.\w+\}|async\s|await\s|\*\*/);
      expect(code, file).not.toMatch(/\(\?<[=!a-zA-Z]|\\p\{/);
    }
  });

  it("the package declares no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
  });
});

describe("the built files work as shipped", () => {
  const replace = vi.fn();

  beforeEach(() => {
    replace.mockReset();
    sessionStorage.clear();
    delete (window as { DeepLinker?: unknown }).DeepLinker;
    delete (window as { __deeplinker?: unknown }).__deeplinker;
    vi.stubGlobal("location", { href: "https://example.com/property/42?a=1#top", replace });
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      platform: "",
      maxTouchPoints: 0,
      language: "en",
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("the IIFE with a config inlined runs by itself and exposes window.DeepLinker", async () => {
    const code = dist("deeplinker.iife.min.js").replace(PLACEHOLDER, JSON.stringify(config));
    (0, eval)(code);
    const api = (window as unknown as { DeepLinker: Record<string, unknown> }).DeepLinker;
    expect(Object.keys(api).sort()).toEqual(["go", "init", "on", "open", "resolve"]);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("https://apps.apple.com/app/id123456789"));
  });

  it("loading the IIFE twice runs the routing once", async () => {
    const code = dist("deeplinker.iife.min.js").replace(PLACEHOLDER, JSON.stringify(config));
    (0, eval)(code);
    (0, eval)(code);
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("the IIFE left as shipped (no config) does nothing and does not throw", () => {
    expect(() => (0, eval)(dist("deeplinker.iife.min.js"))).not.toThrow();
    expect(replace).not.toHaveBeenCalled();
  });

  it("the UMD sets window.DeepLinker without running anything", () => {
    (0, eval)(dist("deeplinker.umd.js"));
    const api = (window as unknown as { DeepLinker: { init: unknown } }).DeepLinker;
    expect(typeof api.init).toBe("function");
    expect(replace).not.toHaveBeenCalled();
  });

  it("the UMD returns the API to a CommonJS loader and to an AMD loader", () => {
    const code = dist("deeplinker.umd.js");
    const cjs = { exports: {} as { init?: unknown } };
    new Function("module", "define", code)(cjs, undefined);
    expect(typeof cjs.exports.init).toBe("function");

    let defined: unknown;
    const define = Object.assign((_deps: unknown[], factory: () => unknown) => (defined = factory()), {
      amd: true,
    });
    new Function("module", "define", code)(undefined, define);
    expect(typeof (defined as { init?: unknown }).init).toBe("function");
  });
});
