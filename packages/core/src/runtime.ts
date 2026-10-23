// Everything the browser bundle may import from core. Keep this barrel free of Zod and of anything large:
// importing "@deeplinker/core" (index.ts) would pull the config schema into the runtime and blow the size budget.
export * from "./constants";
export type * from "./types";
export { splitUrl, joinUrl } from "./url/preserve";
export type { UrlParts } from "./url/preserve";
export { matchesDeepLinkPath, compileRule } from "./paths/match";
export { toWebAppUrl } from "./paths/path-map";
export { resolveStore, withPlayReferrer } from "./store/resolve";
export type { ResolvedStore } from "./store/resolve";
export { buildAppIntent, buildBrowserEscapeIntent } from "./intent/intent";
export type { IntentLoc } from "./intent/intent";
export { detect } from "./detect/detect";
export { IN_APP_BROWSERS, IN_APP_MANUAL } from "./data/in-app-browsers";
export { decide } from "./decide/decide";
export type { DecideContext } from "./decide/decide";
