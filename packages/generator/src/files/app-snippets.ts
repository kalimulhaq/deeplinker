import type { PathRule, ResolvedConfig } from "@deeplinker/core";
import { ruleParts } from "../util";

export interface AppSnippet {
  platform: "ios" | "macos" | "android" | "windows" | "linux";
  title: string;
  /** Which file or screen the code goes in. */
  where: string;
  code: string;
  language: "xml" | "ini" | "text";
  /** One line: how the app reads the URL it was opened with. */
  readUrl: string;
  notes: string[];
}

/**
 * Turns a path pattern into the intent-filter attribute Android understands. `pathPrefix` is a plain prefix,
 * `pathPattern` has only `.` (any character) and `*` (zero or more of the previous character), so `*` becomes `.*`,
 * `?` becomes `.`, `?*` becomes `..*`, and a literal dot is escaped as `\\.` for the XML.
 * https://developer.android.com/guide/topics/manifest/data-element
 * A pattern that matches everything needs no attribute (null).
 */
export function toAndroidPath(
  pattern: string,
): { attr: "path" | "pathPrefix" | "pathPattern"; value: string } | null {
  if (pattern === "*") return null;
  if (!/[*?]/.test(pattern)) return { attr: "path", value: pattern };
  const head = pattern.slice(0, -1);
  if (pattern.endsWith("*") && !pattern.endsWith("?*") && !/[*?]/.test(head))
    return { attr: "pathPrefix", value: head };

  let value = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "?" && pattern.charAt(i + 1) === "*") {
      value += "..*";
      i++;
    } else if (c === "*") value += ".*";
    else if (c === "?") value += ".";
    else if (c === ".") value += "\\\\.";
    else value += c;
  }
  return { attr: "pathPattern", value };
}

const pathOf = (rule: PathRule) => ruleParts(rule).path;

function appleSnippet(c: ResolvedConfig, platform: "ios" | "macos"): AppSnippet {
  const domains = (prefix: string) => c.domains.map((d) => `        <string>${prefix}:${d}</string>`);
  const lines = [
    platform === "ios" ? "<!-- <YourApp>.entitlements -->" : "<!-- <YourMacApp>.entitlements -->",
    "<key>com.apple.developer.associated-domains</key>",
    "<array>",
    ...domains("applinks"),
    "</array>",
  ];
  if (platform === "ios" && c.apps.ios?.appClip) {
    lines.push(
      "",
      "<!-- App Clip target's .entitlements -->",
      "<key>com.apple.developer.associated-domains</key>",
      "<array>",
      ...domains("appclips"),
      "</array>",
    );
  }
  return {
    platform,
    title: platform === "ios" ? "iOS / iPadOS: Associated Domains" : "macOS: Associated Domains",
    where:
      "Xcode → your app target → Signing & Capabilities → + Capability → Associated Domains, which writes these entries to the .entitlements file." +
      (platform === "ios" && c.apps.ios?.appClip
        ? " For the App Clip, add the appclips: entries to the Clip target."
        : ""),
    code: lines.join("\n"),
    language: "xml",
    readUrl:
      platform === "ios"
        ? "SwiftUI: `.onOpenURL { url in … }` (or `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { $0.webpageURL }`); UIKit: `userActivity.webpageURL` in `scene(_:continue:)` or `application(_:continue:restorationHandler:)`."
        : "In `application(_:continue:restorationHandler:)` read `userActivity.webpageURL` (SwiftUI: `.onOpenURL { url in … }`).",
    notes: [
      "While developing, append `?mode=developer` to an entry (`applinks:example.com?mode=developer`) so the device fetches the file straight from your server instead of Apple's CDN. Remove it before you ship.",
      "Apple's CDN fetches the file within 24 hours of a change and devices re-check about weekly; there is no way to force a refresh, so reinstall the app to test a new file.",
      ...(platform === "macos"
        ? [
            "On macOS, Universal Links open the app reliably from Safari and from some apps; other browsers keep the link in the browser.",
          ]
        : []),
    ],
  };
}

function androidSnippet(c: ResolvedConfig): AppSnippet {
  const android = c.apps.android!;
  const includes = (c.paths?.include ?? []).map(pathOf).filter((p): p is string => p !== undefined);
  const excludes = (c.paths?.exclude ?? []).map(pathOf).filter((p): p is string => p !== undefined);

  const data: string[] = c.domains.map((d) => `        <data android:scheme="https" android:host="${d}" />`);
  for (const pattern of includes) {
    const path = toAndroidPath(pattern);
    if (path) data.push(`        <data android:${path.attr}="${path.value}" />`);
  }

  const lines = [
    '<activity android:name=".MainActivity" android:exported="true">',
    '    <intent-filter android:autoVerify="true">',
    '        <action android:name="android.intent.action.VIEW" />',
    '        <category android:name="android.intent.category.DEFAULT" />',
    '        <category android:name="android.intent.category.BROWSABLE" />',
    ...data,
    "    </intent-filter>",
  ];
  if (excludes.length) {
    lines.push(
      `    <!-- Excluded paths (${excludes.join(", ")}) cannot be written in an intent filter; assetlinks.json enforces them on Android 15+. -->`,
    );
  }
  if (android.scheme) {
    lines.push(
      "",
      "    <!-- For the intent:// attempt from Chrome (apps.android.scheme). -->",
      "    <intent-filter>",
      '        <action android:name="android.intent.action.VIEW" />',
      '        <category android:name="android.intent.category.DEFAULT" />',
      '        <category android:name="android.intent.category.BROWSABLE" />',
      ...c.domains.map((d) => `        <data android:scheme="${android.scheme}" android:host="${d}" />`),
      "    </intent-filter>",
    );
  }
  lines.push("</activity>");

  return {
    platform: "android",
    title: "Android: App Links",
    where: "`AndroidManifest.xml`, inside the `<activity>` that should open these links.",
    code: lines.join("\n"),
    language: "xml",
    readUrl:
      '`intent?.data` in `onCreate` and `onNewIntent` is the full https URI: `uri.path`, `uri.getQueryParameter("id")`, `uri.fragment`.',
    notes: [
      "assetlinks.json must be live before the app is installed; Android reads it at install time. Android 15+ re-checks it periodically (changes can take up to 7 days) and applies the path rules it contains on top of the manifest's.",
      "After someone installs from Google Play, the original URL comes back through the Play Install Referrer: call `InstallReferrerClient.getInstallReferrer()` once on first launch (`com.android.installreferrer:installreferrer`); `installReferrer` is the full URL.",
    ],
  };
}

function windowsSnippet(c: ResolvedConfig): AppSnippet {
  const hosts = c.domains.map((d) => `            <uap3:Host Name="${d}" />`);
  return {
    platform: "windows",
    title: "Windows: web-to-app linking",
    where:
      "`Package.appxmanifest`: declare the namespace on `<Package>`, then add the extension inside `<Application>`. The app must be packaged (MSIX or a sparse package).",
    code: [
      "<Package",
      '  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"',
      '  IgnorableNamespaces="uap uap3"> <!-- add uap3 to your existing IgnorableNamespaces list -->',
      "  <Applications>",
      "    <Application>",
      "      <Extensions>",
      '        <uap3:Extension Category="windows.appUriHandler">',
      "          <uap3:AppUriHandler>",
      ...hosts,
      "          </uap3:AppUriHandler>",
      "        </uap3:Extension>",
      "      </Extensions>",
      "    </Application>",
      "  </Applications>",
      "</Package>",
    ].join("\n"),
    language: "xml",
    readUrl:
      "In `OnActivated`, when `args.Kind == ActivationKind.Protocol`, read `((ProtocolActivatedEventArgs)args).Uri` (Windows App SDK: `AppInstance.GetActivatedEventArgs()`).",
    notes: [
      "Links clicked in Chrome, Firefox and Chromium-based Edge stay in the browser. The app opens from the Run dialog, from other apps (`LaunchUriAsync`, `ShellExecute`) and from Edge Legacy, so do not expect a click on your website in a modern browser to launch it.",
      "windows-app-web-link must be live on every host listed above; changes show up within 1 to 8 days.",
    ],
  };
}

function linuxSnippet(c: ResolvedConfig): AppSnippet {
  const scheme = c.apps.linux!.scheme!;
  return {
    platform: "linux",
    title: "Linux: custom URL scheme",
    where:
      "Your app's `.desktop` file (for a package, installed to `/usr/share/applications/`; for testing, `~/.local/share/applications/`). Register it with `xdg-mime default <app>.desktop x-scheme-handler/" +
      scheme +
      "`.",
    code: [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Your App",
      "Exec=your-app %u",
      `MimeType=x-scheme-handler/${scheme};`,
    ].join("\n"),
    language: "ini",
    readUrl: `The URL arrives as the first command-line argument (the \`%u\` in \`Exec=\`), for example \`${scheme}://${c.domains[0]}/property/42?x=1\`.`,
    notes: [
      "Linux has no verified link mechanism: https links never open the app, and the browser asks the visitor to confirm before it opens a custom scheme.",
    ],
  };
}

/** The exact snippet each app needs, filled in from the config. Only platforms the config has an app for are listed. */
export function renderAppSnippets(c: ResolvedConfig): AppSnippet[] {
  const out: AppSnippet[] = [];
  if (c.apps.ios?.appIds?.length || c.apps.ios?.appClip) out.push(appleSnippet(c, "ios"));
  if (c.apps.macos?.appIds?.length) out.push(appleSnippet(c, "macos"));
  if (c.apps.android) out.push(androidSnippet(c));
  if (c.apps.windows?.packageFamilyName) out.push(windowsSnippet(c));
  if (c.apps.linux?.scheme) out.push(linuxSnippet(c));
  return out;
}

/** `app-snippets.md`: the same content as the `app-snippets` command, saved next to the other generated files. */
export function renderAppSnippetsMarkdown(c: ResolvedConfig): string {
  const parts = ["# What each app needs", "", `Generated for ${c.domains.join(", ")}.`, ""];
  for (const s of renderAppSnippets(c)) {
    parts.push(
      `## ${s.title}`,
      "",
      `**Where:** ${s.where}`,
      "",
      "```" + (s.language === "text" ? "" : s.language),
      s.code,
      "```",
      "",
      `**Reading the URL:** ${s.readUrl}`,
      "",
    );
    for (const n of s.notes) parts.push(`- ${n}`);
    if (s.notes.length) parts.push("");
  }
  return parts.join("\n");
}
