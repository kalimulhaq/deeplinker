# Cloudflare Pages

Detected from `wrangler.toml`. Your `public/_headers` and `public/_routes.json` are extended, not replaced. All of iOS, macOS, Android, Windows and ChromeOS (through the Android app) are configured.

```sh
npm install
npx deeplinker build      # writes deeplinker-dist/
# copy deeplinker-dist/ into public/ (merged _headers and _routes.json replace yours when you are happy with the diff)
npx deeplinker app-snippets
npx deeplinker verify https://example.com   # after deploying
```

`deeplinker.config.ts` is the only file you write; everything in `deeplinker-dist/` is generated. The IDs in it are made up: replace them with yours (`npx deeplinker build` warns about the ones from Apple's and Google's documentation).
