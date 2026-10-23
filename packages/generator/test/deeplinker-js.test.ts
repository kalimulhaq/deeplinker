// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generate } from "../src/generate";
import { RUNTIME_TEMPLATE } from "../src/runtime-template.generated";
import { FP, resolved } from "./helpers";

const config = () =>
  resolved({
    paths: ["/property/*"],
    apps: {
      ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
      android: {
        packageName: "com.example.app",
        sha256CertFingerprints: [FP],
        stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
      },
    },
    web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
  });

const deeplinkerJs = () => generate(config()).files.find((f) => f.path === "deeplinker.js")?.content ?? "";

describe("the runtime built into the generator", () => {
  it("is the real runtime, with the config placeholder exactly once", () => {
    expect(RUNTIME_TEMPLATE.length).toBeGreaterThan(5000);
    expect(RUNTIME_TEMPLATE.split('"__DEEPLINKER_CONFIG__"')).toHaveLength(2);
  });

  it("generates without a runtime warning", () => {
    expect(generate(config()).warnings.filter((w) => /runtime|placeholder/i.test(w))).toEqual([]);
  });

  it("deeplinker.js has the config inlined, no placeholder, and the hash banner", () => {
    const result = generate(config());
    const js = deeplinkerJs();
    expect(js).not.toContain("__DEEPLINKER_CONFIG__");
    expect(js.startsWith(`/*! @kalimulhaq/deeplinker config:${result.hash} */\n`)).toBe(true);
    expect(js).toContain('"hosts":["example.com"]');
  });
});

describe("the config inlined in deeplinker.js", () => {
  it("is plain ASCII, so it parses on old engines and reads the same in any charset", () => {
    const c = resolved({
      web: { url: "https://app.example.com" },
      paths: ["/Ouvrir l\u2019app \u2028 \u2029 \u0645\u0631\u062d\u0628\u0627 </script>/*"],
    });
    const js = generate(c).files.find((f) => f.path === "deeplinker.js")?.content ?? "";
    expect(js.split("").filter((c) => c.charCodeAt(0) > 127)).toEqual([]); // the whole file, runtime included
    expect(js).not.toContain("</script");
    expect(js).toContain("\\u2028");
    // …and it still means the same thing.
    const inlined = JSON.parse(/"include":\[("(?:[^"\\]|\\.)*")/.exec(js)?.[1] ?? "null");
    expect(inlined).toBe("/Ouvrir l\u2019app \u2028 \u2029 \u0645\u0631\u062d\u0628\u0627 </script>/*");
  });
});

describe("the generated deeplinker.js, run in a page", () => {
  const replace = vi.fn();

  beforeEach(() => {
    replace.mockReset();
    sessionStorage.clear();
    delete (window as { DeepLinker?: unknown }).DeepLinker;
    delete (window as { __deeplinker?: unknown }).__deeplinker;
  });

  afterEach(() => vi.unstubAllGlobals());

  function visit(href: string, userAgent: string) {
    vi.stubGlobal("location", { href, replace });
    vi.stubGlobal("navigator", { userAgent, platform: "", maxTouchPoints: 0, language: "en" });
    (0, eval)(deeplinkerJs());
  }

  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const LINUX = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

  it("sends an iPhone to the App Store", async () => {
    visit("https://example.com/property/42?a=1&a=2#top", IPHONE);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("https://apps.apple.com/app/id123456789"));
  });

  it("sends a desktop browser to the web app, query and hash intact", async () => {
    visit("https://example.com/property/42?a=1&a=2&b=#top", LINUX);
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith("https://app.example.com/p/42?a=1&a=2&b=#top"),
    );
  });

  it("leaves other paths alone", async () => {
    visit("https://example.com/about", IPHONE);
    await new Promise((r) => setTimeout(r, 30));
    expect(replace).not.toHaveBeenCalled();
  });
});
