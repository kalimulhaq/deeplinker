import { defineConfig } from "vitest/config";

export default defineConfig({
  // The parity test runs the real command line; one file at a time keeps the machine cool.
  test: { include: ["test/**/*.test.ts"], fileParallelism: false },
});
