import {
  CONFIG_FILE_NAMES,
  PACKAGE_NAME,
  checkAppId,
  checkHttpUrl,
  checkPackageFamilyName,
  checkPackageName,
  checkScheme,
  checkStoreUrl,
  formatIssues,
  normalizeDomain,
  normalizeFingerprint,
  parseConfig,
} from "@deeplinker/core";
import { existsSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { CliError } from "../errors";
import type { Prompter } from "../prompts";

export type Platform = "ios" | "android" | "macos" | "windows" | "linux";

export interface InitAnswers {
  /** Every host name your links use. */
  domains: string[];
  ios?: { appId: string; storeUrl?: string };
  android?: { packageName: string; fingerprint?: string; playUrl?: string };
  macos?: { appId: string; storeUrl?: string };
  windows?: { packageFamilyName: string; storeUrl?: string };
  linux?: { scheme: string };
  webAppUrl?: string;
}

/** The config these answers describe, as data. `init` validates this, and a test pins that the source below says the same. */
export function answersToConfig(a: InitAnswers): Record<string, unknown> {
  const apps: Record<string, unknown> = {};
  if (a.ios) apps.ios = { appIds: [a.ios.appId], ...(a.ios.storeUrl && { storeUrl: a.ios.storeUrl }) };
  if (a.android) {
    apps.android = {
      packageName: a.android.packageName,
      ...(a.android.fingerprint && { sha256CertFingerprints: [a.android.fingerprint] }),
      ...(a.android.playUrl && { stores: { google: a.android.playUrl } }),
    };
  }
  if (a.macos)
    apps.macos = { appIds: [a.macos.appId], ...(a.macos.storeUrl && { storeUrl: a.macos.storeUrl }) };
  if (a.windows) {
    apps.windows = {
      packageFamilyName: a.windows.packageFamilyName,
      ...(a.windows.storeUrl && { storeUrl: a.windows.storeUrl }),
    };
  }
  if (a.linux) apps.linux = { scheme: a.linux.scheme };
  return {
    domains: a.domains,
    ...(Object.keys(apps).length && { apps }),
    ...(a.webAppUrl && { web: { url: a.webAppUrl } }),
  };
}

const q = (value: string) => JSON.stringify(value);
const indent = (lines: string[], by: string) => lines.map((l) => by + l);

/** The text of `deeplinker.config.ts`: plain TypeScript the user keeps editing, with hints where something is left to add. */
export function buildConfigSource(a: InitAnswers): string {
  const apps: string[] = [];
  const block = (name: string, lines: string[]) => apps.push(`${name}: {`, ...indent(lines, "  "), "},");

  if (a.ios)
    block("ios", [
      `appIds: [${q(a.ios.appId)}],`,
      ...(a.ios.storeUrl ? [`storeUrl: ${q(a.ios.storeUrl)},`] : []),
    ]);
  if (a.android) {
    block("android", [
      `packageName: ${q(a.android.packageName)},`,
      a.android.fingerprint
        ? `sha256CertFingerprints: [${q(a.android.fingerprint)}],`
        : "// sha256CertFingerprints: [...],  // needed for App Links: the SHA-256 of the certificate that signs the app",
      ...(a.android.playUrl ? [`stores: { google: ${q(a.android.playUrl)} },`] : []),
    ]);
  }
  if (a.macos)
    block("macos", [
      `appIds: [${q(a.macos.appId)}],`,
      ...(a.macos.storeUrl ? [`storeUrl: ${q(a.macos.storeUrl)},`] : []),
    ]);
  if (a.windows) {
    block("windows", [
      `packageFamilyName: ${q(a.windows.packageFamilyName)},`,
      ...(a.windows.storeUrl ? [`storeUrl: ${q(a.windows.storeUrl)},`] : []),
    ]);
  }
  if (a.linux) block("linux", [`scheme: ${q(a.linux.scheme)},`]);

  const body = [`domains: [${a.domains.map(q).join(", ")}],`];
  if (apps.length) body.push("apps: {", ...indent(apps, "  "), "},");
  else
    body.push(
      "// Add your apps here: apps.ios, apps.android, apps.macos, apps.windows, apps.linux (see the README).",
    );
  if (a.webAppUrl) body.push(`web: { url: ${q(a.webAppUrl)} },`);

  return `import { defineConfig } from ${q(PACKAGE_NAME)};\n\nexport default defineConfig({\n${indent(body, "  ").join("\n")}\n});\n`;
}

const blank = (s: string) => s.trim() === "";
/** A prompt validator from a core check (message or null). Blank is allowed when `optional`. */
const rule =
  (check: (v: string) => string | null, optional = false) =>
  (value: string) =>
    optional && blank(value) ? undefined : (check(value.trim()) ?? undefined);
const domainRule = (value: string) => {
  const r = normalizeDomain(value);
  return r.ok ? undefined : r.message;
};
const domainOf = (value: string) => {
  const r = normalizeDomain(value);
  if (!r.ok) throw new CliError(r.message);
  return r.value;
};
/** "example.com, www.example.com" as a list of host names. */
const domainsOf = (value: string) =>
  value
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .map(domainOf);
const domainsRule = (value: string) =>
  blank(value)
    ? "Enter at least one host name, such as example.com."
    : value
        .split(",")
        .map((d) => domainRule(d.trim()))
        .find(Boolean);
const fingerprintRule = (value: string) =>
  blank(value) || normalizeFingerprint(value)
    ? undefined
    : "Expected 32 bytes of hex, like 14:6D:E9:83:… (keytool -list -v shows it).";

export interface InitOptions {
  cwd: string;
  prompter: Prompter;
  /** Skip every question and write a minimal config. Needs `domains`. */
  yes?: boolean;
  /** Host names, comma separated. */
  domains?: string;
  force?: boolean;
  log: (line: string) => void;
}

/** Asks only what the chosen platforms need, then writes `deeplinker.config.ts`. Never overwrites without `force`. */
export async function runInit(opts: InitOptions): Promise<string> {
  const { cwd, prompter: ask } = opts;
  const target = resolve(cwd, CONFIG_FILE_NAMES[0]);
  const existing = CONFIG_FILE_NAMES.map((n) => resolve(cwd, n)).find((f) => existsSync(f));
  if (existing && !opts.force) {
    throw new CliError(
      `${relative(cwd, existing)} already exists. Edit it, or run \`npx deeplinker init --force\` to replace it.`,
      1,
    );
  }

  let answers: InitAnswers;
  if (opts.yes) {
    if (!opts.domains)
      throw new CliError(
        "--yes needs --domains, for example: npx deeplinker init --yes --domains example.com",
      );
    answers = { domains: domainsOf(opts.domains) };
  } else {
    ask.intro("deeplinker: set up deep links for your site");
    const domains = await ask.text({
      message: "Which domains do your links use? (comma separated)",
      placeholder: "www.example.com",
      initialValue: opts.domains,
      validate: domainsRule,
    });
    answers = { domains: domainsOf(domains) };

    const platforms = await ask.multiselect<Platform>({
      message: "Which apps do you have? (space to select, enter to continue)",
      options: [
        { value: "ios", label: "iOS / iPadOS" },
        { value: "android", label: "Android" },
        { value: "macos", label: "macOS" },
        { value: "windows", label: "Windows" },
        { value: "linux", label: "Linux" },
      ],
    });
    const optionalText = async (
      message: string,
      placeholder: string,
      check: (v: string) => string | null,
      initialValue?: string,
    ) => {
      const value = (
        await ask.text({ message, placeholder, initialValue, validate: rule(check, true) })
      ).trim();
      return value || undefined;
    };

    if (platforms.includes("ios")) {
      const appId = (
        await ask.text({
          message: "iOS app ID (TeamID.bundleId)",
          placeholder: "ABCDE12345.com.example.app",
          validate: rule(checkAppId),
        })
      ).trim();
      answers.ios = {
        appId,
        storeUrl: await optionalText(
          "App Store URL (blank to skip)",
          "https://apps.apple.com/app/id123456789",
          checkStoreUrl,
        ),
      };
    }
    if (platforms.includes("android")) {
      const packageName = (
        await ask.text({
          message: "Android package name",
          placeholder: "com.example.app",
          validate: rule(checkPackageName),
        })
      ).trim();
      const fingerprint = (
        await ask.text({
          message: "SHA-256 fingerprint of the certificate that signs the app (blank to add later)",
          placeholder: "14:6D:E9:83:…",
          validate: fingerprintRule,
        })
      ).trim();
      answers.android = {
        packageName,
        fingerprint: fingerprint ? (normalizeFingerprint(fingerprint) ?? undefined) : undefined,
        playUrl: await optionalText(
          "Google Play URL (blank to skip)",
          "https://play.google.com/store/apps/details?id=" + packageName,
          checkStoreUrl,
          `https://play.google.com/store/apps/details?id=${packageName}`,
        ),
      };
    }
    if (platforms.includes("macos")) {
      const appId = (
        await ask.text({
          message: "macOS app ID (TeamID.bundleId)",
          placeholder: "ABCDE12345.com.example.mac",
          validate: rule(checkAppId),
        })
      ).trim();
      answers.macos = {
        appId,
        storeUrl: await optionalText(
          "Mac App Store URL (blank to skip)",
          "https://apps.apple.com/app/id123456789",
          checkStoreUrl,
        ),
      };
    }
    if (platforms.includes("windows")) {
      const packageFamilyName = (
        await ask.text({
          message: "Windows package family name",
          placeholder: "Example_abc123xyz",
          validate: rule(checkPackageFamilyName),
        })
      ).trim();
      answers.windows = {
        packageFamilyName,
        storeUrl: await optionalText(
          "Microsoft Store link (blank to skip)",
          "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
          checkStoreUrl,
        ),
      };
    }
    if (platforms.includes("linux")) {
      answers.linux = {
        scheme: (
          await ask.text({
            message: "URL scheme your Linux app handles",
            placeholder: "exampleapp",
            validate: rule(checkScheme),
          })
        ).trim(),
      };
    }
    answers.webAppUrl = await optionalText(
      "A web app that visitors without the app should land on? Its URL (blank for none)",
      "https://app.example.com",
      checkHttpUrl,
    );
  }

  // Never write a config that the rest of the tool would reject.
  const check = parseConfig(answersToConfig(answers));
  if (!check.ok)
    throw new CliError(`These answers do not make a valid config:\n${formatIssues(check.errors)}`);

  writeFileSync(target, buildConfigSource(answers));
  opts.log(`Wrote ${relative(cwd, target)}`);
  if (!opts.yes) ask.outro("Next: npx deeplinker build");
  return target;
}
