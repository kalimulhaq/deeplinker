import { defineConfig, devices } from "@playwright/test";

// One worker, one test at a time: the suite is small, and browsers are the heaviest thing in this repository.
// Run a single engine with `pnpm test:browser --project=chromium-android`.
export default defineConfig({
  testDir: "test/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [
    { name: "chromium-android", use: { ...devices["Pixel 7"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 14"] } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
  ],
});
