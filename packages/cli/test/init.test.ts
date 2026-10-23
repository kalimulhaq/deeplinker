import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "@deeplinker/core";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config-loader";
import { answersToConfig, buildConfigSource, runInit, type InitAnswers } from "../src/commands/init";
import { CliError } from "../src/errors";
import type { Prompter } from "../src/prompts";
import { FP, KIT_ALIAS, project } from "./helpers";

/** Answers prompts from a script, in order, and runs each prompt's own validator the way the terminal would. */
function scripted(answers: (string | string[])[]) {
  const asked: string[] = [];
  const queue = [...answers];
  const prompter: Prompter = {
    intro: () => {},
    outro: () => {},
    async text(o) {
      asked.push(o.message);
      const value = String(queue.shift() ?? "");
      const problem = o.validate?.(value);
      if (problem) throw new Error(`validator rejected ${JSON.stringify(value)}: ${problem}`);
      return value;
    },
    async multiselect<T extends string>(o: { message: string }) {
      asked.push(o.message);
      return (queue.shift() ?? []) as T[];
    },
  };
  return { prompter, asked };
}

const FULL: InitAnswers = {
  domains: ["example.com", "www.example.com"],
  ios: { appId: "ABCDE12345.com.example.app", storeUrl: "https://apps.apple.com/app/id123456789" },
  android: {
    packageName: "com.example.app",
    fingerprint: FP,
    playUrl: "https://play.google.com/store/apps/details?id=com.example.app",
  },
  macos: { appId: "ABCDE12345.com.example.mac" },
  windows: {
    packageFamilyName: "Example_abc123xyz",
    storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
  },
  linux: { scheme: "exampleapp" },
  webAppUrl: "https://app.example.com",
};

describe("buildConfigSource", () => {
  it("imports defineConfig from the published package name", () => {
    expect(buildConfigSource({ domains: ["example.com"] })).toContain(
      'import { defineConfig } from "@kalimulhaq/deeplinker";',
    );
  });

  it("describes the same config as answersToConfig, and that config validates", async () => {
    const dir = project({ "deeplinker.config.ts": buildConfigSource(FULL) });
    const loaded = await loadConfig(dir, undefined, { alias: KIT_ALIAS });
    expect(loaded.raw).toEqual(answersToConfig(FULL));
    expect(parseConfig(loaded.raw).ok).toBe(true);
  });

  it("a minimal answer set says where to add apps", () => {
    const source = buildConfigSource({ domains: ["example.com"] });
    expect(source).toContain('domains: ["example.com"]');
    expect(source).toContain("// Add your apps here");
    expect(parseConfig(answersToConfig({ domains: ["example.com"] })).ok).toBe(true);
  });

  it("without a fingerprint it leaves a comment explaining what is needed", () => {
    const source = buildConfigSource({
      domains: ["example.com"],
      android: { packageName: "com.example.app" },
    });
    expect(source).toContain("// sha256CertFingerprints");
    expect(source).toContain("SHA-256");
  });
});

describe("runInit", () => {
  it("--yes writes a minimal valid config without asking anything", async () => {
    const dir = project();
    const { prompter, asked } = scripted([]);
    const lines: string[] = [];
    await runInit({
      cwd: dir,
      prompter,
      yes: true,
      domains: "Example.COM, www.Example.com",
      log: (l) => lines.push(l),
    });
    expect(asked).toEqual([]);
    const source = readFileSync(join(dir, "deeplinker.config.ts"), "utf8");
    expect(source).toContain('domains: ["example.com", "www.example.com"]');
    expect(lines.join("\n")).toContain("deeplinker.config.ts");
  });

  it("--yes without --domains explains what to pass", async () => {
    const error = await runInit({
      cwd: project(),
      prompter: scripted([]).prompter,
      yes: true,
      log: () => {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("--domains");
  });

  it("--yes with a bad domain says what is wrong", async () => {
    const error = await runInit({
      cwd: project(),
      prompter: scripted([]).prompter,
      yes: true,
      domains: "example.com, https://example.com/",
      log: () => {},
    }).catch((e: unknown) => e);
    expect((error as CliError).message).toContain("is a URL");
  });

  it("asks only about the apps you pick", async () => {
    const dir = project();
    const { prompter, asked } = scripted(["example.com", [], ""]);
    await runInit({ cwd: dir, prompter, log: () => {} });
    expect(asked).toHaveLength(3); // domains, which apps, web app
    expect(asked.join("\n")).not.toMatch(
      /iOS app ID|Android package|macOS app ID|Windows package|URL scheme/,
    );
  });

  it("asks the iOS questions for iOS, and the Android ones for Android, and nothing else", async () => {
    const dir = project();
    const { prompter, asked } = scripted([
      "example.com, www.example.com",
      ["ios", "android"],
      "ABCDE12345.com.example.app",
      "https://apps.apple.com/app/id123456789",
      "com.example.app",
      FP.toLowerCase().replaceAll(":", ""),
      "https://play.google.com/store/apps/details?id=com.example.app",
      "https://app.example.com",
    ]);
    await runInit({ cwd: dir, prompter, log: () => {} });
    expect(asked.join("\n")).toContain("iOS app ID");
    expect(asked.join("\n")).toContain("Android package name");
    expect(asked.join("\n")).not.toMatch(/Windows package|macOS app ID|URL scheme/);
    const written = readFileSync(join(dir, "deeplinker.config.ts"), "utf8");
    expect(written).toContain(`sha256CertFingerprints: ["${FP}"]`); // normalised
    expect(written).toContain('domains: ["example.com", "www.example.com"]');
    expect(written).toContain('web: { url: "https://app.example.com" }');
  });

  it("each question validates its answer with an example, as the terminal would", async () => {
    const dir = project();
    const { prompter } = scripted(["https://example.com"]);
    await expect(runInit({ cwd: dir, prompter, log: () => {} })).rejects.toThrow(/is a URL/);
    expect(existsSync(join(dir, "deeplinker.config.ts"))).toBe(false);
  });

  it("refuses to overwrite an existing config, and --force replaces it", async () => {
    const dir = project({ "deeplinker.config.ts": "export default { domains: ['old.example.com'] };" });
    await expect(
      runInit({
        cwd: dir,
        prompter: scripted([]).prompter,
        yes: true,
        domains: "example.com",
        log: () => {},
      }),
    ).rejects.toThrow(/already exists/);
    expect(readFileSync(join(dir, "deeplinker.config.ts"), "utf8")).toContain("old.example.com");
    await runInit({
      cwd: dir,
      prompter: scripted([]).prompter,
      yes: true,
      domains: "example.com",
      force: true,
      log: () => {},
    });
    expect(readFileSync(join(dir, "deeplinker.config.ts"), "utf8")).toContain('"example.com"');
  });

  it("also refuses when a different config format exists", async () => {
    const dir = project({ "deeplinker.config.json": "{}" });
    await expect(
      runInit({
        cwd: dir,
        prompter: scripted([]).prompter,
        yes: true,
        domains: "example.com",
        log: () => {},
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("writes nothing when the user cancels", async () => {
    const dir = project();
    const prompter: Prompter = {
      ...scripted([]).prompter,
      text: async () => {
        throw new CliError("Cancelled. Nothing was written.", 1);
      },
    };
    await expect(runInit({ cwd: dir, prompter, log: () => {} })).rejects.toThrow(/Cancelled/);
    expect(existsSync(join(dir, "deeplinker.config.ts"))).toBe(false);
    writeFileSync(join(dir, "keep"), "");
  });
});
