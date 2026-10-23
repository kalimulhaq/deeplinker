/**
 * Crawlers and non-human clients. Never redirected (they must see the real page for SEO and link previews).
 *
 * Only clients that can run the page's script matter here: crawlers that render pages, link-preview fetchers and headless
 * browsers. Plain HTTP clients (curl, Wget, axios, ...) never execute the runtime, so they are not listed.
 *
 * Each entry is `[id, regex source]`, matched case-insensitively against the user agent; the first hit wins. The last
 * entry catches anything named "...bot", "...crawler" or "...spider", which already covers Googlebot, Bingbot,
 * Yandex, Baidu, DuckDuckBot, Applebot, Twitterbot, LinkedInBot, Slackbot, Discordbot, TelegramBot and the SEO
 * crawlers, so the entries above it are only for fetchers that do not say "bot". To add one: append `|Name` to the
 * right entry (or add a line) and add a row to `fixtures/user-agents/bots.json`; a test fails until every id has a
 * fixture.
 *
 * Keep the regex ES2015-safe: no lookbehind, named groups, dotAll or `\p{…}`.
 */
export const BOTS: readonly (readonly [id: string, pattern: string])[] = [
  [
    "crawler",
    "Google-(?:InspectionTool|Read-Aloud|Site-Verification)|GoogleOther|(?:Mediapartners|Storebot|FeedFetcher)-Google|facebook(?:externalhit|catalog)|BingPreview|^WhatsApp|Slack-ImgProxy",
  ],
  ["lighthouse", "Chrome-Lighthouse|PTST|Speed Insights"],
  ["headless", "HeadlessChrome|PhantomJS|Puppeteer"],
  // A phone brand such as "Cubot" also trips this; that errs on the safe side (no redirect).
  ["generic", "bot[ /;)_-]|bot$|crawl|spider|slurp"],
];
