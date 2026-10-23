export interface ConfigIssue {
  /** Dotted path with array indices, e.g. `apps.android.sha256CertFingerprints[0]`. `(config)` for the root. */
  path: string;
  message: string;
  /** A correct value for this field, as source code. */
  example?: string;
}

/** The slice of a Zod issue this module needs. */
export interface RawIssue {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  keys?: string[];
}

const FINGERPRINT_EXAMPLE =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

/** Keyed by path with array indices replaced by `[]`. `*` stands for any single final segment. */
const EXAMPLES: Record<string, string> = {
  "(config)": 'export default defineConfig({ domains: ["example.com"] })',
  domains: 'domains: ["example.com"]',
  "domains[]": 'domains: ["www.example.com", "m.example.com"]',
  paths: 'paths: ["/property/*", "!/admin/*"]',
  "paths[]": 'paths: ["/property/*", "/search?ref=*", "!/admin/*"]',
  "apps.ios.appIds": 'appIds: ["ABCDE12345.com.example.app"]',
  "apps.ios.appIds[]": 'appIds: ["ABCDE12345.com.example.app"]',
  "apps.ios.storeUrl": 'storeUrl: "https://apps.apple.com/app/id123456789"',
  "apps.ios.appClip": 'appClip: "ABCDE12345.com.example.app.Clip"',
  "apps.android.packageName": 'packageName: "com.example.app"',
  "apps.android.sha256CertFingerprints": `sha256CertFingerprints: ["${FINGERPRINT_EXAMPLE}"]`,
  "apps.android.sha256CertFingerprints[]": `sha256CertFingerprints: ["${FINGERPRINT_EXAMPLE}"]`,
  "apps.android.scheme": 'scheme: "exampleapp"',
  "apps.android.stores.google": 'google: "https://play.google.com/store/apps/details?id=com.example.app"',
  "apps.android.stores.*": 'huawei: "https://appgallery.huawei.com/app/C123456789"',
  "apps.macos.appIds": 'appIds: ["ABCDE12345.com.example.mac"]',
  "apps.macos.appIds[]": 'appIds: ["ABCDE12345.com.example.mac"]',
  "apps.macos.storeUrl": 'storeUrl: "https://apps.apple.com/app/id123456789"',
  "apps.macos.downloadUrl": 'downloadUrl: "https://example.com/download/mac"',
  "apps.windows.packageFamilyName": 'packageFamilyName: "Example_abc123xyz"',
  "apps.windows.storeUrl": 'storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1"',
  "apps.windows.downloadUrl": 'downloadUrl: "https://example.com/download/windows"',
  "apps.linux.scheme": 'scheme: "exampleapp"',
  "apps.linux.stores.*": 'flathub: "https://flathub.org/apps/com.example.app"',
  "apps.linux.downloadUrl": 'downloadUrl: "https://example.com/download/linux"',
  "web.url": 'url: "https://app.example.com"',
  "web.routes": 'routes: [{ from: "/property/:id", to: "/p/:id" }]',
  "web.routes[]":
    '{ from: "/property/:propertyId/leads?id=:leadId", to: "/property/leads?lead=:leadId&p=:propertyId" }',
  "web.routes[].from": 'from: "/property/:id"',
  "web.routes[].to": 'to: "/p/:id"',
  "web.pwa.manifestPath": 'manifestPath: "/manifest.json"',
  "web.pwa.handleLinks": 'handleLinks: "preferred"',
  "behavior.redirect": "redirect: true",
  "behavior.redirectDelayMs": "redirectDelayMs: 0",
  "behavior.skipParam": 'skipParam: "dl_skip"',
  "behavior.redirectInAppBrowsers": "redirectInAppBrowsers: false",
  "behavior.redirectBots": "redirectBots: false",
  "deferred.enabled": "deferred: { enabled: true }",
  hosting: 'hosting: "auto"',
  outDir: 'outDir: "deeplinker-dist"',
};

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += (out ? "." : "") + String(seg);
  }
  return out || "(config)";
}

export function exampleFor(path: string): string | undefined {
  const norm = path.replace(/\[\d+\]/g, "[]");
  return EXAMPLES[norm] ?? EXAMPLES[norm.replace(/\.[^.[\]]+$/, ".*")];
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] as number;
}

function closest(key: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const k of known) {
    const d = distance(key.toLowerCase(), k.toLowerCase());
    if (d < bestDistance) {
      best = k;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(best.length / 3)) ? best : undefined;
}

function describe(issue: RawIssue): string {
  const required = /^Invalid input: expected (\w+), received undefined$/.exec(issue.message);
  if (required) return `is required (expected ${required[1]}).`;
  return issue.message.replace(/^Invalid input: /, "");
}

/** Turns Zod issues into issues a person can act on. `keysAt` lists the valid keys of the object at a path. */
export function toIssues(
  raw: readonly RawIssue[],
  keysAt: (objectPath: string) => readonly string[] | undefined,
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  for (const issue of raw) {
    const parent = issue.path.length ? formatPath(issue.path) : "";
    if (issue.code === "unrecognized_keys" && issue.keys) {
      const known = keysAt(parent.replace(/\[\d+\]/g, "[]"));
      for (const key of issue.keys) {
        const guess = known ? closest(key, known) : undefined;
        const hint = guess
          ? `; did you mean "${guess}"?`
          : known
            ? `. Valid keys here: ${known.join(", ")}.`
            : ".";
        const path = parent ? `${parent}.${key}` : key;
        out.push({
          path,
          message: `Unknown key "${key}"${hint}`,
          example: guess ? exampleFor(parent ? `${parent}.${guess}` : guess) : undefined,
        });
      }
      continue;
    }
    const path = formatPath(issue.path);
    out.push({ path, message: describe(issue), example: exampleFor(path) });
  }
  return out;
}

export function formatIssues(issues: readonly ConfigIssue[]): string {
  const noun = issues.length === 1 ? "problem" : "problems";
  const lines = [`✖ Invalid deeplinker config: ${issues.length} ${noun}`, ""];
  for (const issue of issues) {
    lines.push(`  ${issue.path}`, `    ${issue.message}`);
    if (issue.example) lines.push(`    e.g. ${issue.example}`);
    lines.push("");
  }
  return lines.join("\n");
}
