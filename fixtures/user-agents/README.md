# User-agent fixtures

Rows used by `packages/core/test/detect.test.ts` to pin what `detect()` reports for each browser, device, in-app
browser and crawler.

Each row is:

```json
{
  "name": "unique, human readable",
  "ua": "the user-agent string",
  "uaData": { "brands": [], "mobile": true, "platform": "Android", "model": "Pixel 7" },
  "maxTouchPoints": 5,
  "platform": "MacIntel",
  "expect": { "os": "android", "deviceClass": "phone", "browser": "chrome", "ecosystem": "google" }
}
```

- `uaData`, `maxTouchPoints` and `platform` are optional: they mirror `navigator.userAgentData`,
  `navigator.maxTouchPoints` and `navigator.platform`.
- `expect` must name `os`, `deviceClass` and `browser`. `ecosystem` is required on Android and HarmonyOS rows.
  `inApp` and `bot` default to `null`, so only set them when they apply.
- Rows marked "representative" or "best-effort" are plausible strings for that app or platform, not captures from a
  device the maintainers own. Replace them with real captures when you have one.

To add a store ecosystem, in-app browser or crawler, see `CONTRIBUTING.md`: a data line plus one row here, and a test
fails until both exist.
