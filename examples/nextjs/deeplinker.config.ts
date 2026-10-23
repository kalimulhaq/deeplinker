import { defineConfig } from "@kalimulhaq/deeplinker";

export default defineConfig({
  domains: ["example.com"],
  paths: ["/property/*"],
  apps: {
    ios: { appIds: ["K7ZP4W2Q9X.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: [
        "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90",
      ],
      stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
    },
  },
  web: {
    url: "https://example.com/app",
    routes: [{ from: "/property/:id", to: "/p/:id" }],
    pwa: { manifestPath: "/manifest.json", handleLinks: "preferred" },
  },
  // hosting is detected: next.config.mjs and vercel.json mean Vercel.
});
