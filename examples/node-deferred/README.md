# Deferred deep linking behind nginx

A site served by nginx that also turns on deferred deep linking: someone without the app taps a link, goes to the store, installs, opens the app, and the app opens the page they started from.

```sh
npm install
npx deeplinker build      # writes deeplinker-dist/
```

Besides the association files and `deeplinker.js`, the build writes:

- `deeplinker-dist/deferred/node/server.mjs`: the endpoint. Run it with Node 20 or newer (it listens on `127.0.0.1:3100`; `PORT` changes that).
- `deeplinker-dist/nginx-deeplinker.conf`: the `location` blocks that serve the association files as JSON **and** proxy `/dl/click` and `/dl/match` to the endpoint.

Upload `.well-known/` and `deeplinker.js`, `include` the nginx file in the `server { }` block, start the endpoint, then:

```sh
npx deeplinker verify https://example.com
```

`verify` also posts an empty report to both endpoint paths (nothing is stored) and fails with a pointer if they are not routed to the endpoint.

The apps ask the endpoint with `POST /dl/match`; the README of the repository has the contract and the privacy details. The IDs in `deeplinker.config.ts` are made up: replace them with yours.
