import { OBJECT_KEYS } from "@deeplinker/core";
import { describe, expect, it } from "vitest";
import { EXAMPLE } from "../src/example";
import { FIELDS, applyValues, toJsonText, valuesFromConfig, type Values } from "../src/form";

const blank = (): Values => valuesFromConfig({});
const set = (over: Values): Values => ({ ...blank(), ...over });

describe("the fields", () => {
  it("each edit a key the config schema really has", () => {
    for (const { path } of FIELDS) {
      const keys = path.split(".");
      const parent = keys.slice(0, -1).join(".");
      expect(OBJECT_KEYS[parent], `${path}: no such object in the schema`).toContain(keys[keys.length - 1]);
    }
  });

  it("have distinct paths", () => {
    expect(new Set(FIELDS.map((f) => f.path)).size).toBe(FIELDS.length);
  });
});

describe("valuesFromConfig", () => {
  it("gives empty fields, and the default for a select or a box, when there is no config", () => {
    const values = blank();
    expect(values.domains).toBe("");
    expect(values.paths).toBe("");
    expect(values.hosting).toBe("auto");
    expect(values["behavior.redirect"]).toBe(true);
    expect(values["deferred.enabled"]).toBe(false);
  });

  it("shows the example as lines and strings", () => {
    const values = valuesFromConfig(EXAMPLE);
    expect(values.domains).toBe("example.com\nwww.example.com");
    expect(values.paths).toBe("/property/*\n/listing/*\n!/admin/*");
    expect(values["apps.android.stores.google"]).toContain("play.google.com");
    expect(values.hosting).toBe("nginx");
  });

  it("shows redirect: false as an unticked box", () => {
    expect(valuesFromConfig({ behavior: { redirect: false } })["behavior.redirect"]).toBe(false);
  });

  it("copes with a config that is not an object, or has the wrong types", () => {
    expect(valuesFromConfig(null)).toEqual(blank());
    expect(valuesFromConfig([1, 2])).toEqual(blank());
    expect(valuesFromConfig({ domains: 5, paths: "nope", deferred: { enabled: "yes" } })).toEqual(blank());
  });
});

describe("applyValues", () => {
  it("builds a config from nothing, in the order a person writes it", () => {
    const config = applyValues(
      {},
      set({
        hosting: "vercel",
        "apps.ios.storeUrl": " https://apps.apple.com/app/id1 ",
        domains: "example.com\n www.example.com ",
        paths: "/a/*\r\n\n  !/b/*  \n",
        "deferred.enabled": true,
      }),
    );
    expect(Object.keys(config)).toEqual(["domains", "paths", "apps", "deferred", "hosting"]);
    expect(config).toEqual({
      domains: ["example.com", "www.example.com"],
      paths: ["/a/*", "!/b/*"],
      apps: { ios: { storeUrl: "https://apps.apple.com/app/id1" } },
      deferred: { enabled: true },
      hosting: "vercel",
    });
  });

  it("changes only what the form shows: the example comes back unchanged, key for key", () => {
    const back = applyValues(EXAMPLE, valuesFromConfig(EXAMPLE));
    expect(back).toEqual(EXAMPLE);
    expect(toJsonText(back)).toBe(toJsonText(EXAMPLE));
  });

  it("keeps everything the form has no field for", () => {
    const raw = {
      domains: ["example.com"],
      apps: { ios: { appIds: ["A.b"], appClip: "A.b.Clip" }, macos: { appIds: ["A.m"] } },
      outDir: "out",
      web: { routes: [{ from: "/a", to: "/b" }] },
    };
    const next = applyValues(
      raw,
      set({ ...valuesFromConfig(raw), "apps.ios.storeUrl": "https://x.example/app" }),
    );
    expect(next).toEqual({
      ...raw,
      apps: { ...raw.apps, ios: { ...raw.apps.ios, storeUrl: "https://x.example/app" } },
    });
  });

  it("clearing a field removes its key, and the objects that held only it", () => {
    const raw = {
      domains: ["example.com"],
      apps: { ios: { storeUrl: "https://x.example", appIds: ["A.b"] }, android: { packageName: "a.b" } },
    };
    const next = applyValues(raw, set({ domains: "example.com", "apps.android.packageName": "" }));
    expect(next).toEqual({ domains: ["example.com"] });
    // the iOS fields are untouched by this call only because it did not carry them: clear them explicitly too
    const cleared = applyValues(raw, set({ domains: "example.com", "apps.android.packageName": "a.b" }));
    expect(cleared.apps).toEqual({ android: { packageName: "a.b" } });
  });

  it("writes nothing for a default: Not sure, redirect on, an unticked box", () => {
    const raw = {
      domains: ["example.com"],
      hosting: "nginx",
      behavior: { redirect: false },
      deferred: { enabled: true },
    };
    const next = applyValues(
      raw,
      set({ domains: "example.com", hosting: "auto", "behavior.redirect": true }),
    );
    expect(next).toEqual({ domains: ["example.com"] });
  });

  it("writes redirect: false only when the box is unticked", () => {
    const next = applyValues({}, set({ domains: "example.com", "behavior.redirect": false }));
    expect(next).toEqual({ domains: ["example.com"], behavior: { redirect: false } });
  });

  it("does not modify its input", () => {
    const raw = structuredClone(EXAMPLE);
    applyValues(raw, set({ domains: "other.example", "apps.ios.appIds": "" }));
    expect(raw).toEqual(EXAMPLE);
  });

  it("treats a missing value as 'leave this key alone'", () => {
    expect(applyValues(EXAMPLE, {})).toEqual(EXAMPLE);
  });
});
