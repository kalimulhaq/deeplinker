/**
 * The form is a view of the config JSON, not a second copy of it. Each field names the config key it edits; reading
 * the config fills the fields, and editing a field changes only that key. Everything the form does not show (`ui`,
 * `macos`, `outDir`, rules with query conditions, ...) is left exactly as it is, so the JSON tab stays the full editor.
 */
export type FieldKind = "text" | "lines" | "select" | "checkbox";

export interface Field {
  /** The config key, e.g. `apps.ios.storeUrl`. */
  path: string;
  kind: FieldKind;
  label: string;
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** A checkbox that is on unless the config says otherwise. */
  checkedByDefault?: boolean;
}

export interface Group {
  id: string;
  title: string;
  intro?: string;
  fields: Field[];
}

export type Values = Record<string, string | boolean>;

/** Selecting this option removes the key: it is the default, and spelling it out would only add noise to the JSON. */
const DEFAULTS: Record<string, string> = { hosting: "auto" };

export const GROUPS: Group[] = [
  {
    id: "site",
    title: "Your site",
    fields: [
      {
        path: "domains",
        kind: "lines",
        label: "Domains",
        hint: "The host names your links use, one per line, with no https:// and no path. Each one needs the same files at its own root.",
        placeholder: "www.example.com",
      },
      {
        path: "hosting",
        kind: "select",
        label: "Where it is hosted",
        hint: "Adds the server settings for your host. Not sure: you get the files for plain static hosting.",
        options: [
          { value: "auto", label: "Not sure" },
          { value: "static", label: "Plain static hosting" },
          { value: "apache", label: "Apache" },
          { value: "nginx", label: "nginx" },
          { value: "vercel", label: "Vercel" },
          { value: "netlify", label: "Netlify" },
          { value: "cloudflare", label: "Cloudflare Pages" },
          { value: "laravel", label: "Laravel" },
          { value: "wordpress", label: "WordPress" },
        ],
      },
    ],
  },
  {
    id: "paths",
    title: "Pages that open the app",
    intro: "Leave it empty and every page does. * is any text.",
    fields: [
      {
        path: "paths",
        kind: "lines",
        label: "Pages",
        hint: "One per line, written the way the URL looks: /property/*, /search?ref=*, /promo/*#open. Start a line with ! for pages that never open the app (!/admin/*); those always win.",
        placeholder: "/property/*",
      },
    ],
  },
  {
    id: "ios",
    title: "iPhone and iPad",
    fields: [
      {
        path: "apps.ios.appIds",
        kind: "lines",
        label: "App ID",
        hint: "Your Team ID, a dot, then the bundle ID. One per line.",
        placeholder: "ABCDE12345.com.example.app",
      },
      {
        path: "apps.ios.storeUrl",
        kind: "text",
        label: "App Store link",
        placeholder: "https://apps.apple.com/app/id123456789",
      },
    ],
  },
  {
    id: "android",
    title: "Android",
    fields: [
      {
        path: "apps.android.packageName",
        kind: "text",
        label: "Package name",
        placeholder: "com.example.app",
      },
      {
        path: "apps.android.sha256CertFingerprints",
        kind: "lines",
        label: "Signing certificate fingerprints",
        hint: "SHA-256, one per line. Play Console shows them on the app signing page.",
        placeholder: "14:6D:E9:83:C5:73:06:50:…",
      },
      {
        path: "apps.android.stores.google",
        kind: "text",
        label: "Google Play link",
        placeholder: "https://play.google.com/store/apps/details?id=com.example.app",
      },
    ],
  },
  {
    id: "windows",
    title: "Windows",
    fields: [
      {
        path: "apps.windows.packageFamilyName",
        kind: "text",
        label: "Package family name",
        placeholder: "Example_abc123xyz",
      },
      {
        path: "apps.windows.storeUrl",
        kind: "text",
        label: "Microsoft Store link",
        placeholder: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
      },
    ],
  },
  {
    id: "web",
    title: "No app for their device",
    fields: [
      {
        path: "web.url",
        kind: "text",
        label: "Web app address",
        hint: "Where those visitors go. The path, query and fragment are kept.",
        placeholder: "https://app.example.com",
      },
      {
        path: "behavior.redirect",
        kind: "checkbox",
        checkedByDefault: true,
        label: "Send visitors to the store or the web app",
        hint: "Off: the page stays and your page offers the links itself. Desktop visitors are never sent to a store either way: browsers there keep links in the browser, so the page cannot tell whether the app is installed.",
      },
    ],
  },
  {
    id: "deferred",
    title: "After the install",
    intro:
      "Open the page someone started from once they have installed and opened the app. Writes a small endpoint that you deploy next to your site.",
    fields: [
      { path: "deferred.enabled", kind: "checkbox", label: "Remember where installs came from" },
      {
        path: "deferred.storage",
        kind: "select",
        label: "Where clicks are kept",
        hint: "Which ones work depends on your host; the build warns about the others.",
        options: [
          { value: "", label: "The default for your host" },
          { value: "memory", label: "Memory (one server, or to try it out)" },
          { value: "sqlite", label: "SQLite" },
          { value: "postgres", label: "PostgreSQL" },
          { value: "redis", label: "Redis" },
          { value: "kv", label: "Cloudflare KV" },
        ],
      },
      {
        path: "deferred.basePath",
        kind: "text",
        label: "Endpoint path",
        hint: "Leave empty for /dl.",
        placeholder: "/dl",
      },
      {
        path: "deferred.clipboard",
        kind: "checkbox",
        label: "Also use the iOS clipboard",
        hint: "The endpoint accepts a page URL the app read from the clipboard. Your page copies it, for example when someone taps your App Store button; iOS asks before the app can read it.",
      },
    ],
  },
];

export const FIELDS: Field[] = GROUPS.flatMap((g) => g.fields);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function read(raw: Obj, path: string): unknown {
  let at: unknown = raw;
  for (const key of path.split(".")) {
    if (!isObj(at)) return undefined;
    at = at[key];
  }
  return at;
}

function write(raw: Obj, path: string, value: unknown): void {
  const keys = path.split(".");
  const trail: Obj[] = [raw];
  for (const key of keys.slice(0, -1)) {
    const here = trail[trail.length - 1] as Obj;
    if (value === undefined && !isObj(here[key])) return; // nothing there to remove
    if (!isObj(here[key])) here[key] = {};
    trail.push(here[key] as Obj);
  }
  const last = keys[keys.length - 1] as string;
  const holder = trail[trail.length - 1] as Obj;
  if (value === undefined) {
    delete holder[last];
    // An object this emptied goes too, so clearing a field does not leave `"ios": {}` behind.
    for (let i = trail.length - 1; i > 0; i--) {
      if (Object.keys(trail[i] as Obj).length > 0) break;
      delete (trail[i - 1] as Obj)[keys[i - 1] as string];
    }
  } else holder[last] = value;
}

/** The field values for a config. Anything that is not an object (or is invalid JSON upstream) gives empty fields. */
export function valuesFromConfig(raw: unknown): Values {
  const config = isObj(raw) ? raw : {};
  const values: Values = {};
  for (const field of FIELDS) {
    const value = read(config, field.path);
    if (field.kind === "checkbox")
      values[field.path] = value === undefined ? !!field.checkedByDefault : value === true;
    else if (field.kind === "lines")
      values[field.path] = Array.isArray(value) ? value.filter((v) => typeof v === "string").join("\n") : "";
    else values[field.path] = typeof value === "string" ? value : (DEFAULTS[field.path] ?? "");
  }
  return values;
}

/** Root keys in the order a person would write them; anything else keeps its place after these. */
const ORDER = ["domains", "paths", "apps", "web", "behavior", "deferred", "hosting", "outDir", "debug"];

function ordered(raw: Obj): Obj {
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  return Object.fromEntries(
    Object.entries(raw)
      .map((entry, i) => ({ entry, i }))
      .sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.i - b.i)
      .map(({ entry }) => entry),
  );
}

/**
 * The config with the form's values applied: a new object, the input untouched. A field left empty (or set to its
 * default) removes its key; a list that holds rules the form cannot show (`{ path, query }`) keeps them after the lines.
 */
export function applyValues(raw: unknown, values: Values): Obj {
  const next = structuredClone(isObj(raw) ? raw : {}) as Obj;
  for (const field of FIELDS) {
    const value = values[field.path];
    if (value === undefined) continue;
    let out: unknown;
    // Only a box that differs from its default is written down.
    if (field.kind === "checkbox") out = value === !!field.checkedByDefault ? undefined : value === true;
    else if (field.kind === "lines") {
      const lines = String(value)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const existing = read(next, field.path);
      const rules = Array.isArray(existing) ? existing.filter((v) => typeof v !== "string") : [];
      out = lines.length + rules.length > 0 ? [...lines, ...rules] : undefined;
    } else {
      const text = String(value).trim();
      out = text === "" || text === DEFAULTS[field.path] ? undefined : text;
    }
    write(next, field.path, out);
  }
  return ordered(next);
}

/** The config as the JSON tab shows and `deeplinker.config.json` stores it. */
export const toJsonText = (config: unknown): string => JSON.stringify(config, null, 2) + "\n";
