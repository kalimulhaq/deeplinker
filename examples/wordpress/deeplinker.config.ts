import { defineConfig } from "@kalimulhaq/deeplinker";

export default defineConfig({
  domains: ["example.com"],
  apps: {
    ios: { appIds: ["K7ZP4W2Q9X.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
    android: {
      packageName: "com.example.app",
      sha256CertFingerprints: [
        "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90",
      ],
      // The order is the preference: Samsung phones get the Galaxy Store rather than Google Play.
      stores: {
        huawei: "https://appgallery.huawei.com/app/C100000001",
        samsung: "https://galaxystore.samsung.com/detail/com.example.app",
        google: "https://play.google.com/store/apps/details?id=com.example.app",
      },
    },
  },
  behavior: { redirect: false },
  // hosting is detected: wp-config.php marks this as WordPress.
});
