import { toIssues, type ConfigIssue, type RawIssue } from "./errors";
import { configSchema, OBJECT_KEYS, type DeeplinkerConfig, type ParsedConfig } from "./schema";

/** The parsed config: defaults applied, values normalised. */
export type ResolvedConfig = ParsedConfig & { domains: string[] };

export type ParseResult =
  { ok: true; config: ResolvedConfig; warnings: string[] } | { ok: false; errors: ConfigIssue[] };

/** Identity function that gives `deeplinker.config.ts` autocompletion and type checking. */
export function defineConfig(config: DeeplinkerConfig): DeeplinkerConfig {
  return config;
}

export function parseConfig(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        {
          path: "(config)",
          message: "The config must be an object.",
          example: 'export default defineConfig({ domains: ["example.com"] })',
        },
      ],
    };
  }

  const result = configSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: toIssues(result.error.issues as unknown as RawIssue[], (p) => OBJECT_KEYS[p]),
    };
  }

  return { ok: true, config: result.data, warnings: collectWarnings(result.data) };
}

/** The fingerprint printed in Android's documentation, and the Team ID printed in Apple's. Copied into a real config, they fail silently on devices. */
const SAMPLE_FINGERPRINT =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
const SAMPLE_TEAM_ID = "ABCDE12345";

function collectWarnings(c: ParsedConfig): string[] {
  const out: string[] = [];
  const { ios, android, macos, windows, chromeos } = c.apps;

  for (const [key, ids] of [
    ["apps.ios.appIds", ios?.appIds],
    ["apps.macos.appIds", macos?.appIds],
  ] as const) {
    ids?.forEach((id, i) => {
      if (!/^[A-Za-z0-9]{10}\./.test(id)) {
        out.push(
          `${key}[${i}] "${id}": the Team ID before the dot is normally 10 characters (e.g. ABCDE12345). A wrong Team ID makes Universal Links fail silently.`,
        );
      }
    });
  }

  for (const [key, ids] of [
    ["apps.ios.appIds", ios?.appIds],
    ["apps.macos.appIds", macos?.appIds],
  ] as const) {
    ids?.forEach((id, i) => {
      if (id.startsWith(SAMPLE_TEAM_ID + ".")) {
        out.push(
          `${key}[${i}] "${id}" uses ABCDE12345, the Team ID from Apple's documentation. Replace it with your own (developer.apple.com → Membership).`,
        );
      }
    });
  }

  const winUrl = windows?.storeUrl;
  if (winUrl && /[?&]productid=/.test(winUrl)) {
    out.push(
      "apps.windows.storeUrl uses `productid=`; Microsoft's documentation writes `ProductId=` (ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1).",
    );
  }

  if (android) {
    const fingerprints = [
      ...(android.sha256CertFingerprints ?? []),
      ...(android.otherApps ?? []).flatMap((a) => a.sha256CertFingerprints),
    ];
    if (fingerprints.includes(SAMPLE_FINGERPRINT)) {
      out.push(
        "apps.android uses the sample fingerprint from Android's documentation (14:6D:E9:83:…). Replace it with the SHA-256 of the certificate that signs your app (with Play App Signing, the one in Play Console → App integrity).",
      );
    }
    const hasFingerprints =
      (android.sha256CertFingerprints?.length ?? 0) > 0 || (android.otherApps?.length ?? 0) > 0;
    if (android.packageName && !hasFingerprints) {
      out.push(
        "apps.android has a packageName but no sha256CertFingerprints, so assetlinks.json is skipped and Android App Links will not verify.",
      );
    }
    if (android.sha256CertFingerprints?.length && !android.packageName) {
      out.push(
        "apps.android.sha256CertFingerprints is set without a packageName, so assetlinks.json is skipped.",
      );
    }
    if (android.stores?.google && /[?&]referrer=/.test(android.stores.google)) {
      out.push(
        "apps.android.stores.google already carries a `referrer`; deeplinker leaves it alone and will not add the original URL for the Install Referrer.",
      );
    }
  }

  const storeUrls = [
    ios?.storeUrl,
    macos?.storeUrl,
    macos?.downloadUrl,
    windows?.storeUrl,
    windows?.downloadUrl,
    ...Object.values(android?.stores ?? {}),
    ...Object.values(c.apps.linux?.stores ?? {}),
    c.apps.linux?.downloadUrl,
  ].filter(Boolean);
  if (c.deferred.enabled && storeUrls.length === 0) {
    out.push(
      "deferred.enabled is true but no app has a store URL, so no visitor is ever sent to a store and there is nothing to match after an install.",
    );
  }
  if (c.deferred.clipboard && !c.deferred.enabled) {
    out.push("deferred.clipboard has no effect while deferred.enabled is false.");
  }

  if (chromeos?.useAndroidApp && !android?.stores?.google) {
    out.push(
      "apps.chromeos.useAndroidApp is true but apps.android.stores.google is not set, so ChromeOS visitors fall through to the web app.",
    );
  }

  return out;
}
