# Changelog

All notable changes to `@kalimulhaq/deeplinker` are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- README: the quick start comes first, under a new banner, with badges for the version, downloads, CI, Node, types, the size of `deeplinker.js`, stars and license.

## [0.1.0] - 2026-10-23

### Added

- `deeplinker init`, `build`, `verify` and `app-snippets`: one config file (`deeplinker.config.ts` or `.json`) becomes the association files (`apple-app-site-association`, `assetlinks.json`, `windows-app-web-link`), `deeplinker.js`, the server settings for your host, and the setup each app needs.
- `deeplinker.js`, a browser script under 6 KB gzipped that opens the app, sends visitors to the right store for their device (including Huawei, Samsung, Amazon and Xiaomi), falls back to your web app, or stays on the page. It never adds anything to the page; every decision is announced as a `deeplinker:decision` event with ready-made links, and `DeepLinker.go()` follows one of them.
- Routing rules that move any part of the URL (path segment, query value, fragment) into any part of the web app address, and `to: null` for pages with no web equivalent.
- Host support for Apache, nginx, Vercel, Netlify, Cloudflare Pages, Laravel, WordPress and static hosting, detected from the project or set in the config.
- Deferred deep linking: an endpoint that remembers which page someone came from before they installed the app, with templates for Node, Vercel, Netlify, Cloudflare and PHP, and memory, SQLite, PostgreSQL, Redis and KV storage.
- A web generator: a static page that produces the same files as `deeplinker build`, for sites that do not use Node.
