import { defineConfig } from "vitest/config";

export default defineConfig({
  // These tests start servers and load config files; run one file at a time to keep the machine cool.
  test: { include: ["test/**/*.test.ts"], fileParallelism: false },
});
