# WordPress

Detected from `wp-config.php`. `build` writes a must-use plugin that serves the association files with the right content type and prints the script in every page's `<head>`. The stores are listed in order, so Huawei and Samsung devices get their own stores. `redirect: false` keeps visitors on the page, which offers the links itself.

```sh
npm install
npx deeplinker build      # writes deeplinker-dist/
# copy deeplinker-dist/wordpress/deeplinker.php to wp-content/mu-plugins/; copy deeplinker.js to the site root
npx deeplinker app-snippets
npx deeplinker verify https://example.com   # after deploying
```

`deeplinker.config.ts` is the only file you write; everything in `deeplinker-dist/` is generated. The IDs in it are made up: replace them with yours (`npx deeplinker build` warns about the ones from Apple's and Google's documentation).
