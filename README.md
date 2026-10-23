<p align="center">
  <img src="https://raw.githubusercontent.com/kalimulhaq/deeplinker/main/.github/assets/banner.png" alt="Deeplinker: one link opens your app, sends people to the right app store, falls back to your web app, or stays on the page" width="100%" />
</p>

# Deeplinker

[![npm](https://img.shields.io/npm/v/@kalimulhaq/deeplinker?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@kalimulhaq/deeplinker)
[![Downloads](https://img.shields.io/npm/dm/@kalimulhaq/deeplinker?style=flat-square&label=downloads)](https://www.npmjs.com/package/@kalimulhaq/deeplinker)
[![CI](https://img.shields.io/github/actions/workflow/status/kalimulhaq/deeplinker/ci.yml?branch=main&style=flat-square&label=CI&logo=github)](https://github.com/kalimulhaq/deeplinker/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/@kalimulhaq/deeplinker?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Types](https://img.shields.io/npm/types/@kalimulhaq/deeplinker?style=flat-square&logo=typescript&logoColor=white)](https://www.npmjs.com/package/@kalimulhaq/deeplinker)
[![deeplinker.js size](https://img.shields.io/badge/deeplinker.js-under%206%20KB%20gzip-2ea44f?style=flat-square)](#the-browser-script)
[![Browser dependencies](https://img.shields.io/badge/browser%20dependencies-0-2ea44f?style=flat-square)](#the-browser-script)
[![GitHub stars](https://img.shields.io/github/stars/kalimulhaq/deeplinker?style=flat-square&logo=github)](https://github.com/kalimulhaq/deeplinker/stargazers)
[![License](https://img.shields.io/github/license/kalimulhaq/deeplinker?style=flat-square)](LICENSE)

Turn any page on your website into a deep link. After one config file and one build, a normal `https://` URL on your site:

- **opens your app** with the full URL (path, every query parameter, hash) if it is installed,
- **sends people to the right app store** for their device if it is not,
- **falls back to your web app** (same path, query and hash) if there is no app for their platform,
- or **stays where it is** if there is nowhere to go.

It works with Universal Links (iOS, iPadOS, macOS), App Links (Android, ChromeOS), Windows web-to-app linking and `intent://`, and it needs no paid service and no account.

```sh
npm i -D @kalimulhaq/deeplinker
npx deeplinker init     # a few questions, writes deeplinker.config.ts
npx deeplinker build    # writes everything to deploy into deeplinker-dist/
# upload the files (deeplinker-dist/README-DEPLOY.md says exactly where)
npx deeplinker verify https://example.com
```

- [Quick start](#quick-start)
- [How it decides](#how-it-decides)
- [What `build` writes](#what-build-writes)
- [Web generator](#web-generator)
- [Configuration reference](#configuration-reference)
- [Deploying: Apache, nginx, Vercel, Netlify, Cloudflare, Laravel, WordPress, plain static](#deploying)
- [`verify`](#verify)
- [Setting up each app](#setting-up-each-app)
- [Deferred deep linking](#deferred-deep-linking)
- [The browser script](#the-browser-script)
- [Platform limits](#platform-limits-read-this)
- [Testing on real devices](#testing-on-real-devices)
- [Contributing](#contributing) · [License](#license)

Requires Node.js 22.12 or newer to run the CLI. The browser script has no dependencies and runs in any browser from the ES2015 era onwards.

---

## Quick start

**1. Install**

```sh
npm i -D @kalimulhaq/deeplinker
```

**2. Write one config file.** `npx deeplinker init` asks for your domains and which apps you have, and writes `deeplinker.config.ts`. Or write it by hand:

```ts
import { defineConfig } from "@kalimulhaq/deeplinker";

export default defineConfig({
  domains: ["www.example.com"],
  paths: ["/property/*", "/listing/*", "!/admin/*"],
  apps: {
    ios: { appIds: ["K7ZP4W2Q9X.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: ["A1:B2:…"],
      stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
    },
  },
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
});
```

Only `domains` is required. A config that is wrong says so with the field, the problem and an example:

```
✖ Invalid deeplinker config: 1 problem

  domains[0]
    "https://Example.com/" is a URL; use only the host name.
    e.g. domains: ["www.example.com", "m.example.com"]
```

**3. Build**

```sh
npx deeplinker build
```

Everything goes into `deeplinker-dist/` (change it with `outDir` or `--out`). The command also prints which hosting platform it detected, and, if you already have a `manifest.json`, `.htaccess`, `vercel.json` or `_headers`, a diff of what it would add. **It never edits your files:** merged copies are written into the output folder for you to review and copy over.

**4. Deploy, then verify**

Upload as described in `deeplinker-dist/README-DEPLOY.md`, which is written for your host and your config. Paste `deeplinker-dist/snippet.html` into the `<head>` of your pages. Then:

```sh
npx deeplinker verify https://example.com
npx deeplinker app-snippets      # the setup each app needs
```

## How it decides

When someone opens a URL that matches your `paths`:

|        | Visitor                                                  | What happens                                                                                                                                                                                                                                                                          |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Phone or tablet, app installed                           | The **operating system** opens the app with the full URL (Universal Links / App Links). No JavaScript runs.                                                                                                                                                                           |
| **A2** | Phone or tablet, app not installed                       | The page loads, so the OS did not open the app: they go to the **store for their device** (App Store, Google Play, Huawei AppGallery, Samsung Galaxy Store, Amazon Appstore, Xiaomi GetApps).                                                                                         |
| **A3** | Phone or tablet, no app for their platform               | Rule C.                                                                                                                                                                                                                                                                               |
| **B1** | Desktop (macOS, Windows, Linux, ChromeOS), app installed | The OS opens the app.                                                                                                                                                                                                                                                                 |
| **B2** | Desktop, app not installed                               | The page cannot tell this apart from B1 (desktop browsers keep links in the browser even when the app is installed), so a desktop visitor is **never sent to a store automatically**: they go to the web app (rule C1), or stay with the store link announced for your page to offer. |
| **B3** | Desktop, no desktop app                                  | Rule C.                                                                                                                                                                                                                                                                               |
| **C1** | A web app is configured                                  | They go to the **web app**, with your `routes` applied and the query and hash kept byte for byte.                                                                                                                                                                                     |
| **C2** | No web app                                               | They **stay on the page**. No redirect, no error.                                                                                                                                                                                                                                     |

The design rests on one fact: if the page loaded at all, the OS did not open the app. That is true for most links on mobile, but not everywhere. Read [Platform limits](#platform-limits-read-this): on some platforms the page cannot know whether the app is installed, and the script never guesses.

What the script will **never** do: redirect a crawler, redirect twice (a loop guard is set before every redirect), drop, reorder or re-encode a query parameter, set a cookie, run analytics, or call any server other than your own.

## What `build` writes

| File                                                | What it is                                                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.well-known/apple-app-site-association`            | Universal Links for iOS, iPadOS, macOS and App Clips (modern `components` format, with path, query and fragment matching).                                                                |
| `.well-known/assetlinks.json`                       | App Links for every Android package and signing certificate, plus Android 15+ path rules.                                                                                                 |
| `.well-known/windows-app-web-link`                  | Windows web-to-app linking for your package family name.                                                                                                                                  |
| `manifest.fragment.json` (or your manifest, merged) | `related_applications`, `prefer_related_applications`, `handle_links`.                                                                                                                    |
| `deeplinker.js`                                     | The browser script with your config inlined, minified.                                                                                                                                    |
| `snippet.html`                                      | The `<script>` tag to paste into `<head>`.                                                                                                                                                |
| Host files                                          | `.htaccess` (Apache), `nginx-deeplinker.conf`, `vercel.json`, `_headers` (Netlify, Cloudflare Pages) plus `_routes.json`, `laravel/routes/deeplinker.php`, or `wordpress/deeplinker.php`. |
| `README-DEPLOY.md`                                  | Which file goes where, for this config and this host.                                                                                                                                     |
| `app-snippets.md`                                   | The same output as `npx deeplinker app-snippets`.                                                                                                                                         |

Only what your config calls for is written: no iOS app, no `apple-app-site-association`.

`build` options: `--config <file>`, `--out <dir>`, `--hosting <host>`, `--dry-run`. The config file can be `deeplinker.config.ts`, `.mts`, `.js`, `.mjs` or `.json`.

## Web generator

[`apps/web-generator`](./apps/web-generator) is a static page that does the same job as `deeplinker build` without installing anything: fill in a form (or paste a `deeplinker.config.json`), look at each file, and download them all as one ZIP. It uses the same parser and the same generator as the command line, and a test holds the two to the same bytes, file for file, for every host.

```sh
pnpm install
pnpm --filter @deeplinker/web-generator build   # writes apps/web-generator/dist: index.html, app.js, styles.css
```

A hosted copy of each release is at [kalimulhaq.github.io/deeplinker](https://kalimulhaq.github.io/deeplinker/). Or put `dist/` on any static host, or open `index.html` from your disk.

- **Nothing leaves the page.** There is no server and nothing is stored; the page's Content-Security-Policy forbids every network request, and a browser test checks that it makes none.
- **The ZIP unpacks to `deeplinker-dist/`**, the folder `build` writes by default, with the same files in it.
- **The form is a view of the JSON tab.** It edits the keys it shows and leaves every other option as it is, so the JSON tab reaches everything the config file does, and _Download config_ gives you a file the command line can read later.
- **It cannot look at your project.** `build` finds your host, your `.htaccess`, `vercel.json`, `_headers`, `_routes.json` and web app manifest on its own; the page cannot, so _Where it is hosted_ is a choice ("Not sure" means plain static hosting) and an existing file is merged only if you paste it under _Merge with files you already have_.

## Configuration reference

Every field except `domains` is optional. Paths are matched as they appear in the URL.

```ts
export default defineConfig({
  domains: ["www.example.com"], // required: the host names your links use; each needs the same files
  paths: ["/property/*", "!/admin/*"], // which URLs are deep links; ! = never
  apps: { ios, android, macos, windows, linux, chromeos },
  web: { url, routes, pwa },
  behavior: { redirect, redirectDelayMs, redirectInAppBrowsers, redirectBots, skipParam },
  deferred: { enabled, ttlSeconds, basePath, storage, clipboard }, // deferred deep linking; off by default
  hosting: "auto", // or apache | nginx | vercel | netlify | cloudflare | laravel | wordpress | static
  outDir: "deeplinker-dist",
  debug: false, // true: the browser script logs every event to the console
});
```

### `domains`

The host names your links use, one entry per host: `["www.example.com", "m.example.com"]`. Required, at least one. Each entry is a name only (no `https://`, path or port) and exact: `www.example.com` and `example.com` are different hosts, so list each host that serves your pages. A host that only redirects (a bare domain that sends people to `www`) cannot serve the association files, so it does not belong here.

They are used in two places: the app snippets (`app-snippets` writes one `applinks:`, `android:host` and Windows host entry per name) and the deferred endpoint (it only accepts and returns URLs on these hosts). The association files themselves are the same for every host. Each listed host has to serve them at its own root, because Apple, Google and Microsoft fetch them from the host a link is on.

### `paths`

Which URLs on your site are deep links: one list, written the way the URLs look.

```json
"paths": ["/property/*", "/listing/*", "/search?ref=*", "/promo/*#open", "!/admin/*"]
```

- `*` is any text, slashes included: `/property/*` matches `/property/42` and `/property/42/photos`, but not `/property`. It is the only wildcard.
- A `?` starts the query, as in a URL. `/search?ref=*` needs a `ref` parameter, with any value; `?type=lead` needs that exact value; a bare `?ref` only needs the parameter to be there. List several with `&`.
- A `#` starts the fragment: `/promo/*#open` needs the fragment `open`.
- A leading `!` means never: `!/admin/*`. These always win.
- With no entries other than `!` ones, or no `paths` at all, every URL on the site is a deep link.

The same list produces Apple's `components`, Android's dynamic rules and Windows' `paths`/`excludePaths`, and `deeplinker.js` checks it again before doing anything: on any other URL it does nothing, so you can put it in a shared layout. Windows can match on the path only, so a query or fragment condition is approximated there and `build` says so.

### `apps.ios`

| Field      |                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `appIds`   | `["TEAMID.com.example.app"]`. Team ID, a dot, the bundle ID. Several apps are allowed.                   |
| `storeUrl` | Your App Store URL. Used exactly as written, so campaign parameters you add (`pt`, `ct`, `mt`) are kept. |
| `appClip`  | `"TEAMID.com.example.app.Clip"`: listed under `appclips` in the AASA file.                               |

### `apps.android`

| Field                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packageName`              | `com.example.app`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sha256CertFingerprints`   | The SHA-256 of every certificate that signs the app: debug, release and (if you use Play App Signing) Google's key from Play Console → App integrity. Any case, colons optional. Without these, `assetlinks.json` is skipped.                                                                                                                                                                                                                                        |
| `scheme`                   | Optional custom scheme. Lets Chrome on Android make one more attempt to open the app with `intent://`.                                                                                                                                                                                                                                                                                                                                                               |
| `stores`                   | `google`, `huawei`, `samsung`, `amazon`, `xiaomi`: a link to the app in each store you use, used exactly as written. **The order you write them in is the order of preference.** It only matters for Samsung and Xiaomi phones, which can use Google Play as well as their own store: list `samsung` before `google` to send Samsung phones to the Galaxy Store. A device without Google services (Huawei, Fire OS) only ever gets its own store, never Google Play. |
| `otherApps`                | `[{ packageName, sha256CertFingerprints }]`: more packages for the same site (a beta build, a white label).                                                                                                                                                                                                                                                                                                                                                          |
| `dynamicAppLinkComponents` | Default `true`. Writes your `paths` into `assetlinks.json` as Android 15+ dynamic rules.                                                                                                                                                                                                                                                                                                                                                                             |

### `apps.macos`, `apps.windows`, `apps.linux`, `apps.chromeos`

| Field                                                 |                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `macos.appIds`, `macos.storeUrl`, `macos.downloadUrl` | A Mac App Store URL is best written as `https://apps.apple.com/app/id123456789`.                                                                |
| `windows.packageFamilyName`                           | `Example_abc123xyz`. Windows apps must be packaged (MSIX or sparse package).                                                                    |
| `windows.storeUrl`                                    | `ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1` (the capitalisation is Microsoft's). `windows.downloadUrl` is the fallback.                    |
| `windows.allowSubdomains`                             | Only if your Windows app declares wildcard hosts such as `*.example.com`.                                                                       |
| `linux.scheme`                                        | The URL scheme your app registers. Used for the `.desktop` snippet only: Linux has no verified links and the page does not open custom schemes. |
| `linux.stores`                                        | `flathub`, `snap`. `linux.downloadUrl` is the fallback.                                                                                         |
| `chromeos.useAndroidApp`                              | Default `true` when `chromeos` is set: ChromeOS visitors go to Google Play for your Android app.                                                |

### `web`

| Field                           |                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `url`                           | The web app visitors without the app land on. May include a path prefix: `https://example.com/app`.                    |
| `routes`                        | Routing rules for the web app link: where a URL on your site goes on the web app. See [Routing rules](#routing-rules). |
| `pwa.manifestPath`              | Default `/manifest.json`. If a manifest exists there in your project, `build` merges into a copy of it.                |
| `pwa.handleLinks`               | `"auto"` (default, omitted), `"preferred"` or `"not-preferred"`: the manifest's `handle_links`.                        |
| `pwa.preferRelatedApplications` | Default `false`. Leave it: Chromium will not offer to install a PWA that prefers a native app.                         |

### Routing rules

`web.routes` is a list of rules. Each is a pair of URL templates, `from` and `to`, written as `path?query#fragment`. The first rule that matches decides where the visitor goes on the web app (`url` + `to`).

```json
{ "from": "/property/:propertyId/leads?id=:leadId", "to": "/property/leads?lead=:leadId&p=:propertyId" }
```

That rule sends `/property/42/leads?id=abc` to `https://app.example.com/property/leads?lead=abc&p=42`. A capture can come from any part of the URL and go to any part of the target.

- **`:name` captures.** Give each one a name that says what it holds, such as `:propertyId` or `:leadId` (a letter first, then letters, digits or `_`; `:1` is not accepted). In the path it takes one whole segment; in a query it takes the whole value of that parameter; in a fragment, the whole fragment. Use it in `to`, in the path, a query value or the fragment, as often as you like. The value is decoded, trimmed and encoded again, so it is safe wherever it lands (`a b` and `a+b` in a query both come out as `a%20b`).
- **`*` takes the rest of a path**, slashes included, and comes out exactly as written: `{ "from": "/files/*", "to": "/dl/*" }`. It works in the path only.
- **Query parameters in `from` must all be in the URL**, in any order, with other parameters allowed and ignored. A value can be text (`?type=lead`), a capture (`?id=:id`), text around a capture (`?ref=ref-:n`), or absent (`?debug` only needs the parameter to be there). A parameter that is missing, empty or blank means the rule does not match and the next one is tried. If a parameter is repeated, the first one counts.
- **Carry-over.** A rule that mentions a query or a fragment, in `from` or in `to`, builds the target exactly as `to` says: nothing else from the original URL goes along, so a token in the link stays out of the web app. A rule that only maps the path keeps the original query, fragment and trailing slash, as in rule C1.
- **`"to": null`** says this URL has no web equivalent, so the visitor stays on the page. Put it last as a catch-all, or give it a `from` with a query to say that only some URLs have none.
- **No rule matches:** the same path, query and fragment on the web app.
- **Mistakes are caught when you build:** a `:name` in `to` that `from` does not capture, the same name twice, a `*` outside the path, or a `to` that does not start with `/` each say what is wrong and where.

```json
"web": {
  "url": "https://app.example.com",
  "routes": [
    { "from": "/app?lead=:id", "to": "/applicants#:id" },
    { "from": "/app?owner_lead=:id", "to": "/properties/:id" },
    { "from": "/app?listing=:id", "to": "/explore/listings#:id" },
    { "from": "/app", "to": null }
  ]
}
```

On `/app?lead=abc&token=secret` that goes to `https://app.example.com/applicants#abc`, and `/app` on its own stays where it is.

### `behavior`

| Field                   |                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect`              | Default `true`: send visitors to the store for their device or to the web app, as the rules above say. `false`: never navigate; the page stays and the decision, with its links in `choices`, is announced for your page to use.                                                                                                                                                       |
| `redirectDelayMs`       | Default `0`. Wait this long before redirecting.                                                                                                                                                                                                                                                                                                                                        |
| `redirectInAppBrowsers` | Default `false`. Inside Instagram, Facebook, Messenger, LinkedIn, X, TikTok, Snapchat, WeChat, LINE, Telegram and similar apps, which often block app links, the page stays and an `escape` decision is announced. On Android its `target` is an `intent://` link that opens the page in the default browser, for your page to offer. Set `true` to redirect there as everywhere else. |
| `redirectBots`          | Default `false`: crawlers and link previews are never redirected, so they see the page itself.                                                                                                                                                                                                                                                                                         |
| `skipParam`             | Default `"dl_skip"`. `?dl_skip=1` turns every redirect off for that tab.                                                                                                                                                                                                                                                                                                               |

### `deferred`

Off by default. See [Deferred deep linking](#deferred-deep-linking) for what it does.

| Field        | Default            |                                                                                                                                                                                     |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`    | `false`            | Write the endpoint and have `deeplinker.js` report clicks that are about to reach a store.                                                                                          |
| `basePath`   | `"/dl"`            | The endpoint answers `<basePath>/click` and `<basePath>/match`. A plain path: letters, digits and `. _ ~ -`.                                                                        |
| `ttlSeconds` | `3600`             | How long a click can be matched (at least 60).                                                                                                                                      |
| `storage`    | the host's default | `memory`, `sqlite`, `postgres`, `redis` or `kv`. The [table](#choosing-the-endpoint-and-where-clicks-are-kept) says which each host supports; one it cannot use is a build warning. |
| `clipboard`  | `false`            | iOS only: the endpoint also accepts a page URL the app read from the pasteboard. Putting it there is up to your page, for example when someone taps your App Store button.          |

### `hosting`

`"auto"` (default) looks at your project: `vercel.json`, `netlify.toml`, `wrangler.toml`, `artisan`, `wp-config.php`, `next.config.*`, `.htaccess`, `nginx.conf`, and says what it found. Set it explicitly to choose: `apache`, `nginx`, `vercel`, `netlify`, `cloudflare`, `laravel`, `wordpress` or `static`.

### A complete config

Every option, with made-up identifiers. Copy it, delete what you do not use, and replace every value with your own: only `domains` is required. The same file is [`examples/deeplinker.config.json`](./examples/deeplinker.config.json). A test checks that it builds without warnings, uses every option there is, and matches what is shown here.

```json
{
  "domains": ["www.example.com", "m.example.com"],
  "paths": [
    "/property/*",
    "/listing/*",
    "/search?ref=*",
    "/promo/*#open",
    "!/admin/*",
    "!/property/*/print",
    "!/*#no_universal_links"
  ],
  "apps": {
    "ios": {
      "appIds": ["K7ZP4W2Q9X.com.example.app"],
      "storeUrl": "https://apps.apple.com/app/id123456789",
      "appClip": "K7ZP4W2Q9X.com.example.app.Clip"
    },
    "android": {
      "packageName": "com.example.app",
      "sha256CertFingerprints": [
        "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90"
      ],
      "scheme": "exampleapp",
      "stores": {
        "huawei": "https://appgallery.huawei.com/app/C123456789",
        "samsung": "https://galaxystore.samsung.com/detail/com.example.app",
        "amazon": "https://www.amazon.com/gp/mas/dl/android?p=com.example.app",
        "xiaomi": "https://global.app.mi.com/details?id=com.example.app",
        "google": "https://play.google.com/store/apps/details?id=com.example.app"
      },
      "otherApps": [
        {
          "packageName": "com.example.app.beta",
          "sha256CertFingerprints": [
            "0F:1E:2D:3C:4B:5A:69:78:87:96:A5:B4:C3:D2:E1:F0:0F:1E:2D:3C:4B:5A:69:78:87:96:A5:B4:C3:D2:E1:F0"
          ]
        }
      ],
      "dynamicAppLinkComponents": true
    },
    "macos": {
      "appIds": ["K7ZP4W2Q9X.com.example.mac"],
      "storeUrl": "https://apps.apple.com/app/id987654321",
      "downloadUrl": "https://www.example.com/download/mac"
    },
    "windows": {
      "packageFamilyName": "Example.App_abc123xyz",
      "storeUrl": "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
      "downloadUrl": "https://www.example.com/download/windows",
      "allowSubdomains": true
    },
    "linux": {
      "scheme": "exampleapp",
      "stores": {
        "flathub": "https://flathub.org/apps/com.example.app",
        "snap": "https://snapcraft.io/example-app"
      },
      "downloadUrl": "https://www.example.com/download/linux"
    },
    "chromeos": {
      "useAndroidApp": true
    }
  },
  "web": {
    "url": "https://app.example.com",
    "routes": [
      {
        "from": "/property/:id",
        "to": "/p/:id"
      },
      {
        "from": "/property/:propertyId/leads?id=:leadId",
        "to": "/property/leads?lead=:leadId&p=:propertyId"
      },
      {
        "from": "/files/*",
        "to": "/downloads/*"
      },
      {
        "from": "/app?lead=:id",
        "to": "/applicants#:id"
      },
      {
        "from": "/app",
        "to": null
      }
    ],
    "pwa": {
      "manifestPath": "/manifest.json",
      "handleLinks": "preferred",
      "preferRelatedApplications": false
    }
  },
  "behavior": {
    "redirect": true,
    "redirectDelayMs": 0,
    "redirectInAppBrowsers": false,
    "redirectBots": false,
    "skipParam": "dl_skip"
  },
  "deferred": {
    "enabled": true,
    "ttlSeconds": 3600,
    "basePath": "/dl",
    "storage": "redis",
    "clipboard": false
  },
  "hosting": "vercel",
  "outDir": "deeplinker-dist",
  "debug": false
}
```

## Deploying

Whatever the host, the three association files must be served:

- over HTTPS with a valid certificate, at the root of the domain (`/.well-known/…`), **for every domain** you list,
- **directly, with no redirect** (including http → https and apex → `www`), no login, nothing that blocks unknown visitors (Apple's CDN fetches the file from its own servers),
- as `Content-Type: application/json`.

Each guide below is also written, specifically for your config, into `deeplinker-dist/README-DEPLOY.md`.

### Apache

`build` writes an `.htaccess` block, merged at the **top** of yours (it must run before your own rules): it forces `application/json` for the two extensionless files and stops later rewrite rules from touching `/.well-known/`. Upload `.well-known/` and `deeplinker.js` to the web root. If your rules force `https` or `www`, let `/.well-known/` through.

### nginx

`nginx-deeplinker.conf` has one exact-match `location = /.well-known/<file>` per file, which wins over rules that hide dotfiles (`location ~ /\.`). `include` it in the `server { }` block for each domain and reload. If you redirect `http` or the bare domain, do that in a separate `server` block so the association files are served by the final host.

### Vercel

`vercel.json` gets a `headers` entry per file (yours are kept). Put `.well-known/` and `deeplinker.js` in `public/`. Don't add a redirect or rewrite that matches `/.well-known/*`. Next.js projects are detected from `next.config.*`. If you don't deploy on Vercel, set `hosting` explicitly.

### Netlify

A `_headers` block (merged at the end of yours). Put `.well-known/`, `_headers` and `deeplinker.js` in your publish directory.

### Cloudflare Pages

`_headers` plus a `_routes.json` that excludes `/.well-known/*` and `/deeplinker.js` from Functions, so they are served as static files. Existing files are extended, not replaced.

### Laravel

`routes/deeplinker.php` serves the files with the right content type, **outside** the `web` middleware group (no session, no cookies on `/.well-known/`). Register it in `bootstrap/app.php` (Laravel 11+) or `RouteServiceProvider` (older), as the header of the file explains, and copy `deeplinker.js` to `public/`.

### WordPress

`wordpress/deeplinker.php` is a must-use plugin: copy it to `wp-content/mu-plugins/`. It answers the `/.well-known/…` requests itself (so it works on Apache, nginx and managed hosts), and prints the script in every page's `<head>`. Copy `deeplinker.js` to the site root. If a caching plugin or CDN caches 404s, purge `/.well-known/*` once.

### Plain static hosting

Upload `.well-known/` and `deeplinker.js` to the web root and paste `snippet.html` into your pages. Make sure the server sends `application/json` for `apple-app-site-association` and `windows-app-web-link` (most servers send `application/octet-stream` for files with no extension).

## `verify`

```sh
npx deeplinker verify https://example.com
```

Each check passes, fails with a fix, or is skipped with the reason. The summary table is printed and the exit code is `1` if anything failed, so it works in CI.

- **Each `.well-known` file:** HTTP 200, `Content-Type: application/json`, **no redirect**, valid JSON, and the same content as your local config (formatting differences do not count).
- **Apple's CDN copy** of the AASA file. Apple fetches through its own CDN, so a stale copy there is a common cause of "it does not work". The report says how old the copy is and explains the caching: up to 6 hours, re-fetched within 24 hours of a change, no way to force it.
- **Google's Digital Asset Links API** for every package and certificate in `assetlinks.json`.
- **`deeplinker.js`:** loads as JavaScript (not your catch-all page) and was built from the same config as your local one.
- **The deferred endpoint**, when `deferred.enabled` is on: it posts an empty report to `<basePath>/click` (expects HTTP 400) and `<basePath>/match` (expects JSON with a `match` field). Neither stores anything. A 404, a redirect or your home page in reply means the two paths are not routed to the endpoint.
- **Your paths:** every path in `paths` that is a real URL (no wildcard, no `!`) answers 200. For wildcard patterns, pass a real page: `--sample /property/42` (repeatable).

Options: `--config <file>`, `--sample <path>`, `--timeout <ms>`, `--json`, and `--allow-http` for a local test server (the Apple and Google checks are skipped for addresses they cannot reach).

## Setting up each app

```sh
npx deeplinker app-snippets                  # all configured apps
npx deeplinker app-snippets --platform android
```

It prints, filled in from your config, what goes where and how to read the URL the app was opened with:

- **iOS and macOS:** the Associated Domains entitlement (`applinks:example.com` for each domain, `appclips:` for an App Clip). Reading the URL: SwiftUI `.onOpenURL`, or `userActivity.webpageURL`.
- **Android:** the `<intent-filter android:autoVerify="true">` block with your hosts and paths. Reading the URL: `intent?.data`. After a Google Play install, the original URL comes back through the **Play Install Referrer** (`InstallReferrerClient.getInstallReferrer()`, once, on first launch): the script puts the full URL, URL-encoded, in the Play URL's `referrer`. If it would exceed Play's 512-character limit it is omitted, never truncated.
- **Windows:** the `uap3:AppUriHandler` block for `Package.appxmanifest`. Reading the URL: `ProtocolActivatedEventArgs.Uri`.
- **Linux:** the `.desktop` file's `MimeType=x-scheme-handler/<scheme>;`. The URL arrives as the first command-line argument.

## Deferred deep linking

Someone without your app taps a link, goes to the store, installs, and opens the app. Without help the app starts on its home screen and the link they tapped is lost. Deferred deep linking gives it back: on first launch the app asks **your own site's** endpoint where the install came from, and opens that page. There is no hosted service and no account: `build` writes a small endpoint for your host and you deploy it next to your site.

|                             | How the URL reaches the app                                                                                                                                                                                            | How sure                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Android, Google Play**    | `deeplinker.js` puts the full URL, URL-encoded, in the Play URL's `referrer` parameter. The app reads it with the Play Install Referrer API and sends it to `/dl/match`.                                               | Exact: `"match": "deterministic"`                                    |
| **iOS**                     | There is no channel through the App Store. The endpoint remembers each click (see [what is kept](#what-is-kept-and-for-how-long)) and matches the first launch on network, OS major version, device type and language. | A guess: `"match": "probabilistic"`, with a `confidence` from 0 to 1 |
| **iOS, clipboard (opt-in)** | Your page copies its URL when someone taps your App Store button. The app reads it on first launch; iOS tells the user (a notice since iOS 14, a permission prompt since iOS 16).                                      | Exact when it works: `"match": "clipboard"`                          |

`deeplinker.js` only adds the `referrer` to Google Play URLs. For an install from another store (Galaxy Store, AppGallery, GetApps, Amazon) the endpoint falls back to the same network-and-device match as on iOS.

### Turn it on

```ts
deferred: {
  enabled: true;
}
```

Run `npx deeplinker build`. Besides the usual files you get the endpoint under `deeplinker-dist/deferred/…`, the routing rule for your host, and a section in `README-DEPLOY.md` with the steps, the packages to install and the environment it reads. `deeplinker.js` then calls `navigator.sendBeacon("/dl/click", …)` just before sending a visitor to a store. `npx deeplinker verify` checks that the two paths reach the endpoint.

When `deeplinker.js` does not redirect (with `redirect: false`, or a desktop visitor offered a store), the visitor reaches the store through your own page, and the click is still reported:

- A link already on your page that points at one of your configured store URLs (an App Store or Google Play badge, for example) is reported when it is tapped. `deeplinker.js` only listens; the tap goes ahead as it would have, and nothing on the page changes.
- A button you draw from the decision can call `DeepLinker.go(decision.choices.store)`, which reports the click and goes to the store. On Android that link carries the page URL as the Play referrer, which makes the match exact (`deterministic`) instead of a best guess; a plain badge link does not.

### Choosing the endpoint and where clicks are kept

| Host             | The endpoint                                             | Default storage (also works)       | How the two paths reach it                                     |
| ---------------- | -------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| Apache           | PHP file `dl.php`                                        | SQLite                             | a rewrite in the `.htaccess` block                             |
| nginx            | Node server `server.mjs`                                 | SQLite (PostgreSQL, Redis, memory) | `proxy_pass` in `nginx-deeplinker.conf`                        |
| Vercel           | functions in `api/dl/` (`.mjs`) and `lib/deeplinker.mjs` | Redis (PostgreSQL, memory)         | `rewrites` in `vercel.json`                                    |
| Netlify          | `netlify/functions/dl.mjs`                               | Redis (PostgreSQL, memory)         | the function claims its own paths                              |
| Cloudflare Pages | `functions/dl/[[route]].js`                              | KV (memory)                        | `_routes.json` runs Functions for these paths only             |
| Laravel          | PHP file `deeplinker/dl.php`                             | SQLite                             | routes outside the `web` group: no session, no CSRF, no cookie |
| WordPress        | PHP file `mu-plugins/deeplinker/dl.php`                  | SQLite                             | the must-use plugin                                            |
| Plain static     | Node server `server.mjs`                                 | SQLite (PostgreSQL, Redis, memory) | you proxy the two paths                                        |

- **SQLite** needs `better-sqlite3` (Node endpoints) or the `pdo_sqlite` extension (PHP). The PHP file keeps its database in the system temp folder unless `DEEPLINKER_DB` says otherwise, so it is never inside the web root.
- **`memory`** keeps clicks inside one process. That is right for a single Node server and for trying it out; serverless functions and PHP do not share memory between requests, so nothing would ever match (the build warns).
- **PostgreSQL** needs `pg` and `DATABASE_URL`; **Redis** needs `redis` and `REDIS_URL`; **KV** is a Cloudflare binding called `DEEPLINKER_KV`.
- Behind a proxy or CDN, the endpoint must see the visitor's real address. The generated files read it the way each platform documents: the `CF-Connecting-IP` header on Cloudflare, `ipAddress()` from `@vercel/functions` on Vercel, `context.ip` on Netlify. The nginx rule replaces `X-Forwarded-For`, so a visitor cannot choose the address that is recorded. On PHP behind a proxy, set `DEEPLINKER_TRUST_PROXY=1`.

Anything else (Express, Fastify, Deno, a worker of your own) can use the same handler:

```ts
import { createHandler, redisStore } from "@kalimulhaq/deeplinker/deferred";

const handle = createHandler({
  settings: { hosts: ["example.com"], ttlSeconds: 3600, clipboard: false },
  store: redisStore(client), // or memoryStore(), kvStore(), sqliteStore(), postgresStore(), or your own { put, findByPrefix, delete }
  ip: (request) => clientAddress(request), // from where your platform documents it; never from a header a visitor can set
});
// handle(request) -> Promise<Response>; it routes on the last path segment (…/click, …/match).
// toNodeListener(handle) adapts it for node:http.
```

### The API

The full contract is an OpenAPI 3 file: [`packages/deferred/openapi.yaml`](./packages/deferred/openapi.yaml) in this repository, and `@kalimulhaq/deeplinker/openapi.yaml` in the package. In short, with `<base>` your `deferred.basePath` (default `/dl`):

**`POST <base>/click`**: reported by `deeplinker.js`. Body `{"url": "<the page URL exactly as in the address bar>"}`, at most 2 KB, an `http(s)` URL on one of your own domains. It answers `204` and no body, also when it could not tell the visitor's address (it then stores nothing).

**`POST <base>/match`**: asked by the app, once, on first launch. Every field is optional:

```json
{
  "platform": "ios",
  "osVersion": "17.5.1",
  "deviceClass": "phone",
  "language": "en-GB",
  "installReferrer": "<Android: the Play Install Referrer string>",
  "clipboard": "<iOS: the text read from the pasteboard, if clipboard is on>"
}
```

It always answers `200` with JSON, so an app can call it unconditionally:

```json
{ "match": "deterministic", "url": "https://example.com/property/42?a=1&a=2#top" }
{ "match": "probabilistic", "url": "https://example.com/property/42", "confidence": 0.75 }
{ "match": "none" }
```

Order of precedence: a URL in `installReferrer` (deterministic), then a URL in `clipboard` (only when `deferred.clipboard` is on), then the best fit among recent clicks from the same network. `url` is, byte for byte, what the visitor opened, and always one of your own domains: a request can never make the endpoint hand an app a stranger's link. A matched click is deleted, so a second call returns `none`. When two clicks fit equally well the newest wins and the confidence is halved.

Errors are JSON `{"error": "<code>"}`: `400` (`invalid_json`, `invalid_url`), `404` (`not_found`: the last path segment is not `click` or `match`), `405` (`method_not_allowed`, with `Allow: POST`), `413` (`too_large`: bodies are capped at 4 KB), `500` (`server_error`). Every answer carries `Cache-Control: no-store` and no cookie.

### In your apps

A sketch; adapt it to your app. Call `/dl/match` once, on first launch, and remember that you did.

```kotlin
// Android: Google Play Install Referrer (com.android.installreferrer:installreferrer)
val client = InstallReferrerClient.newBuilder(context).build()
client.startConnection(object : InstallReferrerStateListener {
    override fun onInstallReferrerSetupFinished(code: Int) {
        if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
            val referrer = client.installReferrer.installReferrer // the original URL; the endpoint also accepts it percent-encoded
            // POST {"platform": "android", "installReferrer": referrer} to https://example.com/dl/match
        }
        client.endConnection()
    }
    override fun onInstallReferrerServiceDisconnected() {}
})
```

```swift
// iOS
let body: [String: Any] = [
    "platform": "ios",
    "osVersion": UIDevice.current.systemVersion,
    "deviceClass": UIDevice.current.userInterfaceIdiom == .pad ? "tablet" : "phone",
    "language": Locale.preferredLanguages.first ?? "",
    // "clipboard": UIPasteboard.general.string ?? ""   // only if you turned the clipboard method on; iOS 16+ asks the user to allow the paste
]
// POST it as JSON to https://example.com/dl/match
```

Treat the answers by how sure they are. Open `deterministic` and `clipboard` results straight away. A `probabilistic` result is somebody else's click now and then, whenever several people on one network install within the hour: use it silently only above a confidence you are comfortable with (0.75 is a starting point, not a measured threshold), and otherwise offer it ("Continue to the page you were looking at?") or ignore it.

### What is kept, and for how long

For each click that reaches a store, until `ttlSeconds` has passed or the click is matched (whichever comes first), and nowhere else:

- the page URL,
- the first part of the visitor's address: the first three bytes of an IPv4 address (a /24) or the first 48 bits of an IPv6 address (a /48), **never the full address**,
- the operating system and its major version (`ios`, `17`),
- the device type (`phone`, `tablet`, `desktop`) and the primary language (`en`),
- the time.

Not kept: the full IP address, the user agent string, any cookie or other identifier (the endpoint sets none and reads none), or anything about the visitor beyond the above. A click is deleted the moment it is matched. Expired clicks are never matched, and every store removes them on its own schedule: Cloudflare KV expires them itself, Redis when a click for the same network is recorded or looked up (and the whole list when that network goes quiet), and the SQL stores and memory whenever a click is recorded or looked up.

Two things are outside deeplinker. Your web server, CDN or hosting platform has its own access logs with full addresses; the endpoint cannot change that. And whether you need consent, or a line in your privacy policy, depends on where your visitors are: matching on network and device traits is the kind of thing privacy law treats as personal data in some places. Say what you do, and take advice if you are unsure. The clipboard method is explicit by design: iOS tells the user when an app reads the pasteboard (a notice since iOS 14, a prompt since iOS 16) unless the user pressed a system paste control such as `UIPasteControl` or SwiftUI's `PasteButton`, which Apple treats as consent.

## The browser script

`deeplinker.js` runs on your pages and makes the decision above. Its code is under **6 KB minified and gzipped** (the build fails if it grows past that); your config is inlined into the file, so `deeplinker.js` is that plus roughly 0.3 KB for a typical config. It has no dependencies, never throws into your page, and logs only when `debug: true`.

What it does, in order, for a visitor:

1. Stop if the visitor is a crawler, the URL has `?dl_skip=1`, or this tab was already redirected.
2. Stop unless the path is one of your `paths`.
3. In an in-app browser (unless `redirectInAppBrowsers` is on): stay, and announce an `escape` decision. On Android its `target` is an `https` `intent://` link that opens the default browser, for your page to offer. A generic Android WebView of unknown ownership is left alone.
4. If the browser's `getInstalledRelatedApps()` reports your app, stay: never send someone who has the app to the store. On Android the decision's `choices.open` opens the app, for your page to offer.
5. On Chrome for Android with a `scheme`, navigate to `intent://…#Intent;scheme=…;package=…;S.browser_fallback_url=…;end`: one more chance to open the app, falling back to the store or the web app.
6. Otherwise send them to the store for their device, else the web app, else stay. With `deferred.enabled`, a store redirect is preceded by `navigator.sendBeacon("<basePath>/click", {"url": <the page's URL>})`.
7. Before any navigation, set the loop guard in `sessionStorage`. If `sessionStorage` is blocked, an in-memory flag is used and a same-site web target carries `?dl_skip=1`.
8. With `redirect: false`, stay and announce the decision instead of navigating. On desktop, a store is never a redirect target (rule B2).

It never adds anything to your page or changes anything on it. When it stays, the decision has already been announced, with the ready-made links in `choices`, so your page can offer "Open in app", "Get the app" or "Open in your browser" in its own design.

It also detects the store ecosystem on Android (Huawei without Google services, Samsung, Amazon Fire OS, Xiaomi), using Client Hints when the browser sends them and the user agent otherwise. Chrome hides the device model in its user agent, so on an Android that looks like a stock Google device it asks for the `model` Client Hint, briefly, to tell them apart.

### API

```ts
import { DeepLinker } from "@kalimulhaq/deeplinker/runtime"; // or window.DeepLinker from the UMD file

DeepLinker.init(config); // sets the config and runs it. { run: false } sets it without running.
await DeepLinker.resolve(); // the decision, without acting on it
await DeepLinker.open(); // the decision, then acts on it
DeepLinker.go(decision.choices.store); // for your own buttons: sets the loop guard, reports a store click, navigates
const off = DeepLinker.on("decision", (d) => {
  /* … */
}); // returns an unsubscribe function
```

Events: `detect` (what the visitor is), `decision`, `redirect`, `stay`, `error`. Each is also dispatched on `window` as `deeplinker:<name>` with the payload in `detail`. The generated `deeplinker.js` calls `init` for you; the config shape is the output of `toRuntimeConfig()` from the package.

A decision looks like `{ action: "redirect" | "intent" | "prompt" | "escape" | "none", reason, target?, choices: { open?, store?, web? }, linkHandling: "os" | "partial" | "none", delayMs }`. `linkHandling` tells a custom UI whether this browser hands verified links to the OS at all.

Files: `@kalimulhaq/deeplinker/runtime` (ES module), `@kalimulhaq/deeplinker/runtime/umd` (UMD: `window.DeepLinker`, CommonJS, AMD). `deeplinker.js` from `build` is the same code as a self-running script with your config inlined.

## Safari's Smart App Banner

deeplinker adds nothing to your pages, so Safari's Smart App Banner is yours to add if you want it. It is a single tag; Safari then shows a banner with "Open" when the app is installed and "View" when it is not, which also covers the case where iOS does not open a Universal Link (a URL typed into the address bar). Put the page's own URL in `app-argument` so "Open" lands on the right screen:

```html
<meta name="apple-itunes-app" content="app-id=123456789, app-argument=https://www.example.com/property/42" />
```

`app-id` is the number in your App Store link (`…/id123456789`). Write the tag on the server, where you know the page URL; commas in the URL must be written as `%2C`.

## Platform limits (read this)

Some things no web page can do. deeplinker does not try to hack around them.

- **The page cannot tell whether your app is installed** on iOS Safari, on Firefox (any platform) or on Chrome for macOS and Linux. So it never guesses: it relies on "the page loaded, so the OS did not open the app".
- **iOS does not open Universal Links** for a URL typed or pasted into the address bar, or for a link on the same domain as the page you are on. In those cases the page loads even though the app is installed, and the redirect to the App Store reaches people who already have the app. Safari's own Smart App Banner helps there (see [below](#safaris-smart-app-banner)). If this matters to you, set `redirect: false` and offer the links on your page.
- **Windows browsers never hand a link to the app.** Microsoft's documentation: "Supported links clicked in supported browsers (for example, Microsoft Edge Chromium, Firefox, Internet Explorer, etc.), will keep you in the browsing experience." The app opens from the Run dialog, other apps and Edge Legacy, not from a click in Chrome, Firefox or Chromium Edge. So on Windows the page loads even when the app is installed. That is why a desktop visitor is never sent to a store automatically (rule B2): they go to the web app, or stay with the store link offered in the decision.
- **macOS:** Universal Links work reliably from Safari and some apps; Chrome and Firefox keep the link in the browser.
- **Linux has no verified link mechanism.** Only custom URL schemes exist, and the browser asks before opening one. The page does not try.
- **Many in-app browsers block Universal Links and App Links.** That is why the script stays there and announces an `escape` decision instead of redirecting. Apps that also block `intent://` (WeChat) get no `target`: the only way out is the app's own "open in browser" menu. Gmail's and Google's mobile apps normally open links in the system browser, so they cannot be told apart.
- **The `intent://` syntax cannot carry the URL fragment** (`#Intent;…` is its delimiter). The app launched that way receives path and query, not the hash. The store or web-app fallback, and links opened by the OS (A1), keep the hash.
- **iOS has no way to pass data through the App Store.** Deferred deep linking on iOS is therefore a best guess (or the opt-in clipboard), never a guarantee; Android with the Play Install Referrer is exact. deeplinker only uses the Play Install Referrer: installs from other stores (Galaxy Store, AppGallery, GetApps, Amazon) are matched like iOS ones.
- **Apple's CDN** fetches association files within 24 hours of a change and devices re-check about weekly. There is no way to force it: reinstall the app to test a new file, or use `applinks:example.com?mode=developer` while developing.
- **Android** reads `assetlinks.json` when the app is installed; Android 15 re-checks periodically (changes can take up to seven days).
- **Web App Manifest:** `related_applications` has no registered value for the iOS App Store, so none is written for iOS. `getInstalledRelatedApps()` is experimental and Chromium-only in practice; its result is only ever used as a "yes", never as "not installed".

## Testing on real devices

Emulators and automated browsers do not trigger the operating system's link handling, so these checks are by hand. The unit tests, the browser tests (Chromium, WebKit and Firefox against a fixture page) and the `verify` tests cover the generated files and the script's decisions; **only a real device shows whether the OS opens your app.** Deploy first, run `npx deeplinker verify`, then:

**iPhone or iPad (Safari, and Chrome)**

1. Install a build with the Associated Domains entitlement (`app-snippets` prints it). During development add `?mode=developer` to the entry and turn on Developer mode, or reinstall to refresh Apple's cached copy.
2. Open a matching link from **Notes or Messages**. Expected: the app opens on the right screen with the full URL.
3. Paste the same URL into Safari's address bar. Expected: the page loads (a known iOS limit); with `redirect: true` it goes to the App Store, with `redirect: false` it stays.
4. Tap a link to the same domain from one of your own pages. Expected: stays in Safari (known limit).
5. Delete the app. Open the link again. Expected: App Store.
6. Open the link inside Instagram or Facebook. Expected: the page stays, and your page's own escape hint (if you added one) shows.

**Android with Chrome, and with Samsung Internet**

1. Install the app, then check verification: `adb shell pm get-app-links com.example.app` should list your domain as `verified`. Re-run it with `adb shell pm verify-app-links --re-verify com.example.app`.
2. Tap a matching link in **Gmail, Messages or Keep**. Expected: the app opens with the full URL.
3. Uninstall the app and tap again. Expected: Google Play, and after installing, the Install Referrer holds the original URL.
4. On a Samsung device, check Galaxy Store routing if you configured it; in Samsung Internet, check the links open the app.
5. Open the link inside Instagram or Facebook. Expected: the page stays; an escape decision with an `intent://` target is announced.

**Deferred deep linking** (when `deferred.enabled` is on)

1. On Android: with the app uninstalled, open a link in Chrome and install from Play. Open the app once and call `/dl/match` with the Install Referrer. Expected: `deterministic` with the URL you started from, byte for byte.
2. On iOS: with the app uninstalled, open a link on **cellular or the same Wi-Fi the app will be opened on**, install from the App Store, open the app and call `/dl/match`. Expected: `probabilistic`, the right URL, and a confidence near 1 when nobody else on that network clicked. Try it from two phones on the same Wi-Fi at the same time to see the confidence drop.
3. With `clipboard: true`: tap your page's App Store button (which copies the URL), install, open the app and read the pasteboard. Expected: iOS asks to allow the paste, and the URL matches as `clipboard`.

**Huawei device without Google services:** open the link in Huawei Browser with the app uninstalled. Expected: AppGallery if `stores.huawei` is set, otherwise the web app (never Google Play).

**Windows:** press Win+R and paste a matching URL. Expected: the app opens (a click in Chrome or Edge will **not**; see the limits above). Check the manifest with `AppHostRegistrationVerifier.exe example.com <PackageFamilyName> <path to windows-app-web-link>`.

**Mac:** click a matching link in Safari (the app should open) and in Chrome (it will not). `sudo swcutil dl -d example.com` shows what the system downloaded.

Record what you saw for each: which parts are verified on hardware and which only in tests is worth knowing before you ship.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): setting up, how the packages fit together, how to add a store, an in-app browser or a crawler, and the size budget.

## License

[MIT](./LICENSE)
