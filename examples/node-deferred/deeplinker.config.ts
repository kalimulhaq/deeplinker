import { defineConfig } from "@kalimulhaq/deeplinker";

export default defineConfig({
  domains: ["example.com"],
  paths: ["/property/*", "!/admin/*"],
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
  web: { url: "https://app.example.com", routes: [{ from: "/property/:id", to: "/p/:id" }] },
  // A site behind nginx (or any server you can put a reverse proxy in front of): the endpoint is a small Node server.
  hosting: "nginx",
  // Someone without the app taps a link, installs from the store, opens the app: the app asks the endpoint where
  // they came from. `memory` keeps clicks inside the one Node process, which is right for a single server and for
  // trying it out; `sqlite` (needs better-sqlite3), `postgres` (pg) and `redis` survive a restart.
  deferred: { enabled: true, storage: "memory" },
});
