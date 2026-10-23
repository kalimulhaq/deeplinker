# Contributing

Thank you for helping. deeplinker is small on purpose: one config file in, a set of files and one small script out.

## Setting up

```sh
corepack enable          # or: npm i -g pnpm
pnpm install
pnpm build               # builds the runtime, embeds it into the generator, builds the kit
pnpm test                # unit tests for every package
pnpm lint && pnpm typecheck
```

Requires Node.js 18 or newer. Run a single package's tests with `pnpm --filter @deeplinker/core test`; for one file, `cd packages/core && pnpm exec vitest run test/detect.test.ts`.

Other checks:

| Command                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @deeplinker/runtime size` | The size gate: fails when the browser runtime is over 6 KB minified and gzipped.                                                                                                                                                                                                                                                                                                                                        |
| `pnpm e2e:examples`                      | Packs the kit, installs it into a scratch folder, and runs `init`, `build` and `verify` on every project in `examples/`. Run `pnpm --filter @kalimulhaq/deeplinker build` first.                                                                                                                                                                                                                                        |
| `pnpm test:browser`                      | Playwright: Chromium, WebKit and Firefox against a fixture page and against the built web generator (no network). Run `pnpm build` first: the tests use the built kit and `apps/web-generator/dist`. Install the browsers once with `pnpm exec playwright install`; WebKit and Firefox need system libraries on Linux (`pnpm exec playwright install --with-deps`). Use `--project=chromium-android` to run one engine. |

## How the packages fit together

```
packages/core        config schema, detection, URL and path rules, store resolution, the routing decision.
                     No DOM and no Node APIs: it runs in the browser, in Node, and in the web generator.
packages/generator   config -> files. A pure function: no file system. Merges are done on strings the caller supplies.
packages/runtime     the browser script. A thin executor over core's decide(); no dependencies; 6 KB budget.
packages/cli         init, build, verify, app-snippets. All file-system and network access lives here.
packages/deferred    deferred deep linking: the request handler (Request -> Response), the storage adapters, the endpoint templates
                     `build` writes, and openapi.yaml, the contract. Pure: no file system.
packages/deeplinker  the one published package, @kalimulhaq/deeplinker. It bundles the five above.
apps/web-generator  a static page that runs the generator in the browser and downloads the files as a ZIP.
examples/            small projects, one per kind of host, used by `pnpm e2e:examples`.
fixtures/            user-agent fixtures used by the detection tests.
```

The runtime imports only from `@deeplinker/core/runtime`. Importing the package root would pull the config schema (and Zod) into the browser bundle.

## Adding a store ecosystem, an in-app browser or a crawler

All three are data, in `packages/core/src/data/`. Each has a fixture file, and a test fails until every entry has at least one fixture row, so you cannot add one without proving it.

**An in-app browser** (`data/in-app-browsers.ts`). Add `["id", "regex source"]`. The first match wins, so put it above any entry whose user agent it also contains. Add `, 1` as a third element if the app blocks `intent://` (visitors then get instructions instead of a button). Then add a row to `fixtures/user-agents/in-app.json` with the real user agent and `"expect": { …, "inApp": "id" }`.

**A crawler** (`data/bots.ts`). Anything whose user agent contains `bot/`, `crawler` or `spider` is already caught by the last entry. Add to the first entries only fetchers that do not say so (like `facebookexternalhit`). Add a row to `fixtures/user-agents/bots.json`.

**An Android store ecosystem** (`data/stores.ts`, `detect/detect.ts`, `config/schema.ts`). Add the store to `ANDROID_STORE_IDS` in `constants.ts`, say in `ANDROID_STORE_CHAIN` which stores devices of that ecosystem can use, teach `detectEcosystem` to recognise those devices, and the schema accepts it under `apps.android.stores` (it reads the ids from `ANDROID_STORE_IDS`). Add user-agent fixtures (`fixtures/user-agents/android.json`) and a case in `packages/core/test/store.test.ts`. Do not invent store URL formats or tracking parameters: a store URL is passed through exactly as the user wrote it.

Keep the regular expressions ES2015-safe (no lookbehind, named groups, dotAll or `\p{}`): a test checks.

## Deferred deep linking

The handler in `packages/deferred/src/handler.ts` is the one implementation; the Cloudflare, Vercel, Netlify and Node endpoints only wire it to a platform. The PHP endpoint (`phpEndpoint` in `templates.ts`) is a port of it, because PHP hosts cannot run the JavaScript: change one, change the other, and run `packages/deferred/test/templates.test.ts`, which starts a real `php -S` and holds both to the same conversation. `openapi.yaml` is the contract; a test checks it against the handler's real answers, so update it with the code.

A new storage adapter implements the three methods of `Store` (`put`, `findByPrefix`, `delete`) and goes through the shared tests in `test/stores.test.ts`. It must delete expired clicks itself, and never keep more than `ClickRecord` holds: no full IP address, no user agent, no cookie.

## The size budget

The browser runtime must stay under 6 KB minified and gzipped, and the build fails if it does not. Data you add to the runtime counts. If a change goes over, trim something else or make the case in the pull request; do not raise the limit in `packages/runtime/scripts/size-check.mjs` on your own.

## Platform details

Never write a platform format, a store URL format or a tracking parameter from memory. Check it against the vendor's documentation, link the source in a code comment, and say in the pull request what you checked. If the vendor does not document it, treat the value as opaque: accept it from the user and pass it through.

## Pull requests

- Add or update tests. A bug fix starts with a test that fails.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- User-visible changes get a line in `CHANGELOG.md` under `[Unreleased]`.
- Keep commits focused, with a message that says why.

## Releasing

Only `@kalimulhaq/deeplinker` is published; the other packages are bundled into it. A release is a tag:

1. Move the `[Unreleased]` entries in `CHANGELOG.md` into a new section, `## [0.2.0] - 2026-11-02`, and set the same version in `packages/deeplinker/package.json`.
2. `pnpm release:check v0.2.0` says whether the version and the changelog agree.
3. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The `Release` workflow then runs every CI check, publishes to npm through npm trusted publishing (no token is stored; npm adds provenance), creates the GitHub Release from the changelog section, and deploys the web generator to GitHub Pages. If any check fails, nothing is published.

By contributing you agree that your contribution is licensed under the MIT license.
