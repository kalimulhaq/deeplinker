import { OBJECT_KEYS, formatIssues, parseConfig } from "@deeplinker/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const contributing = readFileSync(resolve(root, "CONTRIBUTING.md"), "utf8");

describe("README.md", () => {
  it("documents every config key in the schema (add the key to the reference when you add it to the schema)", () => {
    const undocumented: string[] = [];
    for (const [path, keys] of Object.entries(OBJECT_KEYS)) {
      for (const key of keys) {
        // A key is documented when it appears as code: `key`, or key: in an example, or as a table cell.
        if (!new RegExp("`" + key + "`|\\b" + key + "\\s*:|\\b" + key + "\\b").test(readme))
          undocumented.push(`${path || "(root)"}.${key}`);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it("has the four-step quick start with the real commands", () => {
    for (const command of [
      "npm i -D @kalimulhaq/deeplinker",
      "npx deeplinker init",
      "npx deeplinker build",
      "npx deeplinker verify https://example.com",
    ]) {
      expect(readme).toContain(command);
    }
  });

  it("covers every routing rule", () => {
    for (const rule of ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2"])
      expect(readme).toContain(`**${rule}**`);
  });

  it("has a deploy guide for every host the generator supports", () => {
    for (const host of [
      "Apache",
      "nginx",
      "Vercel",
      "Netlify",
      "Cloudflare Pages",
      "Laravel",
      "WordPress",
      "Plain static hosting",
    ]) {
      expect(readme).toContain(`### ${host}`);
    }
  });

  it("states the platform limits, including the Windows finding", () => {
    expect(readme).toContain("Windows browsers never hand a link to the app");
    expect(readme).toContain("Linux has no verified link mechanism");
  });
});

describe("public files", () => {
  it("never point at the private working notes or mention how the project was planned", () => {
    for (const [name, text] of [
      ["README.md", readme],
      ["CONTRIBUTING.md", contributing],
    ] as const) {
      expect(text, name).not.toMatch(/docs\/(plan|decisions|brief)|the brief|agentic|superpowers/i);
    }
  });
});

describe("the complete config sample", () => {
  const file = readFileSync(resolve(root, "examples/deeplinker.config.json"), "utf8");
  const sample = JSON.parse(file) as Record<string, unknown>;
  const shown = /### A complete config[\s\S]*?```json\n([\s\S]*?)\n```/.exec(readme)?.[1] ?? "";

  it("is the one the README shows", () => {
    expect(shown).not.toBe("");
    expect(JSON.parse(shown)).toEqual(sample);
  });

  it("is valid and builds without a single warning", () => {
    const result = parseConfig(sample);
    expect(result.ok, result.ok ? "" : formatIssues(result.errors)).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("uses every option the schema has, so a new option cannot be added without showing it here", () => {
    const at = (path: string): Record<string, unknown> | undefined => {
      let node: unknown = sample;
      for (const key of path === "" ? [] : path.split(".")) {
        const name = key.replace("[]", "");
        node = (node as Record<string, unknown> | undefined)?.[name];
        if (key.endsWith("[]")) node = Array.isArray(node) ? node[0] : undefined;
      }
      return node as Record<string, unknown> | undefined;
    };
    const missing: string[] = [];
    for (const [path, keys] of Object.entries(OBJECT_KEYS)) {
      const node = at(path);
      for (const key of keys) if (!node || !(key in node)) missing.push(`${path || "(root)"}.${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("generates every platform's files from it", async () => {
    const { generate } = await import("@deeplinker/generator");
    const result = parseConfig(sample);
    if (!result.ok) throw new Error(formatIssues(result.errors));
    const files = generate(result.config).files.map((f) => f.path);
    expect(files).toEqual(
      expect.arrayContaining([
        ".well-known/apple-app-site-association",
        ".well-known/assetlinks.json",
        ".well-known/windows-app-web-link",
        "deeplinker.js",
        "vercel.json",
        "README-DEPLOY.md",
      ]),
    );
  });
});
