import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Where `import { defineConfig } from "@kalimulhaq/deeplinker"` should resolve to while testing from the monorepo. */
export const KIT_ALIAS = { "@kalimulhaq/deeplinker": resolve(here, "../../core/src/index.ts") };

export const FP =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project directory, removed after the test. `files` maps relative paths to contents. */
export function project(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "deeplinker-cli-"));
  made.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

export const FULL_CONFIG = `import { defineConfig } from "@kalimulhaq/deeplinker";

export default defineConfig({
  domains: ["example.com", "www.example.com"],
  paths: ["/property/*", "!/admin/*"],
  apps: {
    ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: ["${FP}"],
      stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
    },
    windows: { packageFamilyName: "Example_abc123xyz", storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1" },
  },
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }], pwa: { handleLinks: "preferred" } },
  hosting: "apache",
});
`;

/** The same config as FULL_CONFIG as a JSON file body (no TypeScript loader involved), with top-level overrides. */
export function configJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      domains: ["example.com", "www.example.com"],
      paths: ["/property/*", "!/admin/*"],
      apps: {
        ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
        android: {
          packageName: "com.example.app",
          sha256CertFingerprints: [FP],
          stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
        },
        windows: {
          packageFamilyName: "Example_abc123xyz",
          storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
        },
      },
      web: {
        url: "https://app.example.com",
        routes: [{ from: "/property/:id", to: "/p/:id" }],
        pwa: { handleLinks: "preferred" },
      },
      hosting: "apache",
      ...overrides,
    },
    null,
    2,
  );
}
