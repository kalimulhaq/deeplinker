export interface IntentLoc {
  host: string;
  pathname: string;
  /** Raw, including the `?`. */
  search: string;
}

const intent = (loc: IntentLoc, parts: string) =>
  `intent://${loc.host}${loc.pathname}${loc.search}#Intent;${parts};end`;

/**
 * `intent://` URL for Chrome on Android: open the app that handles `scheme` (and `pkg`, when known) with the
 * current path and query, and send the browser to `fallbackUrl` when Chrome does not launch it. The fragment cannot
 * be carried: `#Intent;…` is the delimiter, so the app receives path and query only.
 * https://developer.chrome.com/docs/android/intents
 */
export function buildAppIntent(o: {
  scheme: string;
  pkg?: string;
  loc: IntentLoc;
  fallbackUrl?: string;
}): string {
  return intent(
    o.loc,
    "scheme=" +
      o.scheme +
      (o.pkg ? ";package=" + o.pkg : "") +
      (o.fallbackUrl ? ";S.browser_fallback_url=" + encodeURIComponent(o.fallbackUrl) : ""),
  );
}

/**
 * An https VIEW intent for the same URL. Inside an in-app browser it asks Android to open the link in the default
 * browser (or in the app itself, when App Links are verified). Only ever wired to a tap.
 */
export const buildBrowserEscapeIntent = (loc: IntentLoc): string =>
  intent(loc, "scheme=https;action=android.intent.action.VIEW");
