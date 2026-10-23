import { z } from "zod";
import {
  ANDROID_STORE_IDS,
  DEFAULT_LOOP_GUARD_PARAM,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_OUT_DIR,
  HOSTING_IDS,
} from "../constants";
import { routeProblems } from "../paths/route";
import type { AndroidStoreId, PathRule, PathsConfig } from "../types";
import * as f from "./fields";

/** A string field that is checked by one of the validators in fields.ts. */
function checked(check: (value: string) => string | null) {
  return z.string().transform((value, ctx) => {
    const message = check(value);
    if (message) {
      ctx.issues.push({ code: "custom", message, input: value });
      return z.NEVER;
    }
    return value;
  });
}

const startsWithSlash = (v: string) => (v.startsWith("/") ? null : `"${v}" must start with "/".`);
/** A URL path that is safe to write into nginx, Apache, Vercel and PHP config: letters, digits and `._~-`, no `//`, `.` or `..` segments. */
const safeBasePath = (v: string) =>
  startsWithSlash(v) ??
  (/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(v) && !v.split("/").some((s) => s === "." || s === "..")
    ? v.toLowerCase().startsWith("/.well-known")
      ? `"${v}" cannot be under /.well-known, which is reserved for the association files.`
      : null
    : `"${v}" must be a plain path such as "/dl" or "/api/links": letters, digits and . _ ~ - only, and no trailing slash.`);
const plainPath = (v: string) =>
  startsWithSlash(v) ??
  (v.split("/").some((s) => s === "." || s === "..")
    ? `"${v}" must not contain "." or ".." segments; it is a place inside your site, e.g. "/manifest.json".`
    : null);

const domain = z
  .string({
    error: (iss) => (iss.input === undefined ? "is required (expected string)." : "must be a string."),
  })
  .transform((value, ctx) => {
    const r = f.normalizeDomain(value);
    if (!r.ok) {
      ctx.issues.push({ code: "custom", message: r.message, input: value });
      return z.NEVER;
    }
    return r.value;
  });

/** Every host name your links use, normalised, without repeats. At least one: the app snippets and the deferred endpoint need it. */
const domains = z
  .array(domain, {
    error: (iss) =>
      iss.input === undefined
        ? "is required (expected a list of host names)."
        : 'must be a list of host names, such as ["example.com"].',
  })
  .min(1, "needs at least one host name.")
  .transform((list) => list.filter((d, i) => list.indexOf(d) === i));

const fingerprint = z.string().transform((value, ctx) => {
  const normalised = f.normalizeFingerprint(value);
  if (!normalised) {
    ctx.issues.push({
      code: "custom",
      message: `"${value}" is not a SHA-256 certificate fingerprint: expected 32 bytes of hex, e.g. 14:6D:E9:…`,
      input: value,
    });
    return z.NEVER;
  }
  return normalised;
});

const storeUrl = checked(f.checkStoreUrl);
const httpUrl = checked(f.checkHttpUrl);
const appId = checked(f.checkAppId);

/** `"TEAM.bundle.Clip"` or `{ appId: "TEAM.bundle.Clip" }`, normalised to the string. */
const appClip = z.unknown().transform((v, ctx): string => {
  const id = typeof v === "string" ? v : (v as { appId?: unknown } | null)?.appId;
  const message = typeof id === "string" ? f.checkAppId(id) : 'must be an app ID string or { appId: "..." }.';
  if (message) {
    ctx.issues.push({ code: "custom", message, input: v });
    return z.NEVER;
  }
  return id as string;
}) as unknown as z.ZodType<string, string | { appId: string }>;

/**
 * `paths` is one list: `["/property/*", "/search?ref=*", "!/admin/*"]`. Entries starting with `!` are exclusions, which
 * always win. Read into the include/exclude rules the generator and the browser use.
 */
const pathsSchema = z.array(z.string()).transform((entries, ctx): PathsConfig => {
  const include: PathRule[] = [];
  const exclude: PathRule[] = [];
  entries.forEach((entry, i) => {
    const r = f.parsePathEntry(entry);
    if (!r.ok) ctx.issues.push({ code: "custom", message: r.message, input: entry, path: [i] });
    else (r.exclude ? exclude : include).push(r.rule);
  });
  return { ...(include.length && { include }), ...(exclude.length && { exclude }) };
});

const iosSchema = z.strictObject({
  appIds: z.array(appId).min(1).optional(),
  storeUrl: storeUrl.optional(),
  appClip: appClip.optional(),
});

/**
 * `{ samsung: "…", google: "…" }`: a link per store, and the order you write them in is the order of preference (it
 * only matters for Samsung and Xiaomi phones, which can use Google Play as well as their own store). Read by hand
 * rather than with `z.strictObject`, which would rebuild the object in its own key order and lose yours.
 */
type AndroidStores = Partial<Record<AndroidStoreId, string>>;
const androidStoresSchema = z.unknown().transform((v, ctx): AndroidStores => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    ctx.issues.push({
      code: "custom",
      message: 'must be an object of store links, e.g. { google: "https://play.google.com/…" }.',
      input: v,
    });
    return z.NEVER;
  }
  const out: AndroidStores = {};
  for (const [key, url] of Object.entries(v)) {
    if (!(ANDROID_STORE_IDS as readonly string[]).includes(key)) {
      ctx.issues.push({
        code: "custom",
        message: `Unknown store "${key}" (valid: ${ANDROID_STORE_IDS.join(", ")}).`,
        input: v,
        path: [key],
      });
      continue;
    }
    const problem =
      typeof url === "string" ? f.checkStoreUrl(url) : "must be a link to the app in that store.";
    if (problem) ctx.issues.push({ code: "custom", message: problem, input: url, path: [key] });
    else out[key as AndroidStoreId] = url as string;
  }
  return out;
}) as unknown as z.ZodType<AndroidStores, AndroidStores>;

const androidExtraAppSchema = z.strictObject({
  packageName: checked(f.checkPackageName),
  sha256CertFingerprints: z.array(fingerprint).min(1),
});

const androidSchema = z.strictObject({
  packageName: checked(f.checkPackageName).optional(),
  sha256CertFingerprints: z.array(fingerprint).optional(),
  scheme: checked(f.checkScheme).optional(),
  stores: androidStoresSchema.optional(),
  otherApps: z.array(androidExtraAppSchema).optional(),
  dynamicAppLinkComponents: z.boolean().default(true),
});

const macosSchema = z.strictObject({
  appIds: z.array(appId).min(1).optional(),
  storeUrl: storeUrl.optional(),
  downloadUrl: httpUrl.optional(),
});

const windowsSchema = z.strictObject({
  packageFamilyName: checked(f.checkPackageFamilyName).optional(),
  storeUrl: storeUrl.optional(),
  downloadUrl: httpUrl.optional(),
  allowSubdomains: z.boolean().optional(),
});

const linuxStoresSchema = z.strictObject({
  flathub: httpUrl.optional(),
  snap: httpUrl.optional(),
});

const linuxSchema = z.strictObject({
  scheme: checked(f.checkScheme).optional(),
  stores: linuxStoresSchema.optional(),
  downloadUrl: httpUrl.optional(),
});

const chromeosSchema = z.strictObject({
  useAndroidApp: z.boolean().default(true),
});

const appsSchema = z.strictObject({
  ios: iosSchema.optional(),
  android: androidSchema.optional(),
  macos: macosSchema.optional(),
  windows: windowsSchema.optional(),
  linux: linuxSchema.optional(),
  chromeos: chromeosSchema.optional(),
});

const routeSchema = z
  .strictObject({
    from: z.string(),
    to: z.string().nullable(),
  })
  .superRefine((rule, ctx) => {
    for (const { field, message } of routeProblems(rule))
      ctx.addIssue({ code: "custom", path: [field], message });
  });

const pwaSchema = z.strictObject({
  manifestPath: checked(plainPath).default(DEFAULT_MANIFEST_PATH),
  handleLinks: z.enum(["auto", "preferred", "not-preferred"]).default("auto"),
  preferRelatedApplications: z.boolean().default(false),
});

const webSchema = z.strictObject({
  url: httpUrl.optional(),
  routes: z.array(routeSchema).optional(),
  pwa: pwaSchema.prefault({}).optional(),
});

const behaviorSchema = z.strictObject({
  /** Send visitors to the store or web app. Off: the page stays and the decision is announced for the page to use. */
  redirect: z.boolean().default(true),
  redirectDelayMs: z.number().int().min(0).max(10_000).default(0),
  /** Redirect visitors inside Instagram, Facebook and other in-app browsers too. Off: the page stays and the decision is announced. */
  redirectInAppBrowsers: z.boolean().default(false),
  /** Redirect crawlers too. Off: search engines and link previews always see the page itself. */
  redirectBots: z.boolean().default(false),
  skipParam: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/, "must contain only letters, digits, _ . -")
    .default(DEFAULT_LOOP_GUARD_PARAM),
});

const deferredSchema = z.strictObject({
  enabled: z.boolean().default(false),
  ttlSeconds: z.number().int().min(60).default(3600),
  basePath: checked(safeBasePath).default("/dl"),
  /** Unset means the default for the hosting platform (KV on Cloudflare, Redis on Vercel and Netlify, SQLite elsewhere). */
  storage: z.enum(["memory", "sqlite", "postgres", "redis", "kv"]).optional(),
  clipboard: z.boolean().default(false),
});

const rootShape = {
  domains,
  paths: pathsSchema.optional(),
  apps: appsSchema.prefault({}),
  web: webSchema.optional(),
  behavior: behaviorSchema.prefault({}),
  deferred: deferredSchema.prefault({}),
  hosting: z.enum(["auto", ...HOSTING_IDS]).default("auto"),
  outDir: z.string().min(1).default(DEFAULT_OUT_DIR),
  debug: z.boolean().default(false),
};

export const configSchema = z.strictObject(rootShape);

/** What a user writes (defaults not applied yet). */
export type DeeplinkerConfig = z.input<typeof configSchema>;
/** What the schema produces (defaults applied, values normalised). */
export type ParsedConfig = z.output<typeof configSchema>;

/** Valid keys of every object in the schema, by path (array indices written as `[]`). Powers "did you mean". */
export const OBJECT_KEYS: Record<string, readonly string[]> = {
  "": Object.keys(rootShape),
  apps: Object.keys(appsSchema.shape),
  "apps.ios": Object.keys(iosSchema.shape),
  "apps.android": Object.keys(androidSchema.shape),
  "apps.android.stores": [...ANDROID_STORE_IDS],
  "apps.android.otherApps[]": Object.keys(androidExtraAppSchema.shape),
  "apps.macos": Object.keys(macosSchema.shape),
  "apps.windows": Object.keys(windowsSchema.shape),
  "apps.linux": Object.keys(linuxSchema.shape),
  "apps.linux.stores": Object.keys(linuxStoresSchema.shape),
  "apps.chromeos": Object.keys(chromeosSchema.shape),
  web: Object.keys(webSchema.shape),
  "web.routes[]": Object.keys(routeSchema.shape),
  "web.pwa": Object.keys(pwaSchema.shape),
  behavior: Object.keys(behaviorSchema.shape),
  deferred: Object.keys(deferredSchema.shape),
};
