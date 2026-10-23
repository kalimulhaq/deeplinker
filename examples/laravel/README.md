# Laravel

Detected from `artisan`. `build` writes `routes/deeplinker.php`, which serves the association files as JSON from Laravel itself (outside the `web` middleware group, so no cookies or sessions on `/.well-known/`). Windows and Linux apps are configured too.

```sh
npm install
npx deeplinker build      # writes deeplinker-dist/
# copy deeplinker-dist/laravel/routes/deeplinker.php to routes/ and register it as its header says; copy deeplinker.js to public/
npx deeplinker app-snippets
npx deeplinker verify https://example.com   # after deploying
```

`deeplinker.config.ts` is the only file you write; everything in `deeplinker-dist/` is generated. The IDs in it are made up: replace them with yours (`npx deeplinker build` warns about the ones from Apple's and Google's documentation).
