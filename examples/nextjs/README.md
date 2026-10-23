# Next.js on Vercel

Detected from `next.config.mjs` and `vercel.json`. Your `vercel.json` headers are kept and the association-file headers are added; your manifest already has `handle_links: "not-preferred"`, so `build` keeps your value and reports the difference instead of overwriting it.

```sh
npm install
npx deeplinker build      # writes deeplinker-dist/
# copy deeplinker-dist/.well-known into public/; copy deeplinker.js into public/; merge the printed vercel.json and manifest changes
npx deeplinker app-snippets
npx deeplinker verify https://example.com   # after deploying
```

`deeplinker.config.ts` is the only file you write; everything in `deeplinker-dist/` is generated. The IDs in it are made up: replace them with yours (`npx deeplinker build` warns about the ones from Apple's and Google's documentation).
