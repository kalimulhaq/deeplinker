/**
 * Apps that open links in their own embedded browser. Many of them block Universal Links and App Links, so the
 * visitor is offered a way out to the real browser instead of being redirected.
 *
 * Each entry is `[id, regex source, manual?]`, matched case-insensitively against the user agent; the first hit wins
 * (Messenger sits above Facebook because its user agent contains the Facebook tokens too). A trailing `1` means the
 * app is known to block `intent://`, so Android visitors get written instructions instead of a button.
 *
 * To add one: append a line here and add a row to `fixtures/user-agents/in-app.json` (a test fails until every id has
 * a fixture). Keep the regex ES2015-safe: no lookbehind, named groups, dotAll or `\p{…}`.
 *
 * Gmail is best-effort: both of its mobile apps normally open links in Safari View Controller / Chrome Custom Tabs,
 * whose user agent is the system browser's, so it is only detectable where an app build exposes the token.
 */
export const IN_APP_BROWSERS: readonly (readonly [id: string, pattern: string, manual?: 1])[] = [
  ["instagram", "Instagram"],
  ["messenger", "Orca-Android|MessengerForiOS|MessengerLite|FB_IAB/MESSENGER|FBAN/Messenger"],
  ["facebook", "FBAN|FBAV|FB_IAB|FB4A|FBIOS"],
  ["linkedin", "LinkedInApp"],
  ["twitter", "Twitter for (?:iPhone|iPad)|TwitterAndroid"],
  ["tiktok", "musical_ly|BytedanceWebview|trill_|TikTok"],
  ["snapchat", "Snapchat"],
  ["wechat", "MicroMessenger", 1],
  ["line", "\\bLine/"],
  ["telegram", "Telegram"],
  ["gmail", "\\bGmail\\b"],
  ["googleapp", "\\bGSA/"],
  // Generic Android System WebView ("; wv)") after every named app, so named apps win.
  ["webview", "; wv\\)"],
];

/** Ids of the apps flagged `manual` above: they block `intent://`, so visitors get instructions instead of a button. */
export const IN_APP_MANUAL: ReadonlySet<string> = new Set(
  IN_APP_BROWSERS.filter((e) => e[2]).map((e) => e[0]),
);
