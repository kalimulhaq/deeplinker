# Plain static site

A site with no framework and no server config: HTML files, an existing `manifest.json` (which `build` merges into without changing your fields), and a path rule that also matches on a query parameter.

```sh
npm install
npx deeplinker build      # writes deeplinker-dist/
# upload deeplinker-dist/.well-known and deeplinker.js to the web root; paste snippet.html into your pages
npx deeplinker app-snippets
npx deeplinker verify https://example.com   # after deploying
```

`deeplinker.config.ts` is the only file you write; everything in `deeplinker-dist/` is generated. The IDs in it are made up: replace them with yours (`npx deeplinker build` warns about the ones from Apple's and Google's documentation).
