import { defineConfig } from "@kalimulhaq/deeplinker";

export default defineConfig({
  domains: ["example.com"],
  paths: ["/property/*", "/listing/*", "/search?ref=*", "!/admin/*"],
  apps: {
    ios: { appIds: ["K7ZP4W2Q9X.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: [
        "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90",
      ],
      scheme: "exampleapp",
      stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
    },
  },
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
  hosting: "static",
});
