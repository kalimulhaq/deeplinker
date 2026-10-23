// Fails the build when the browser runtime grows past its budget: 6 KB (6144 bytes) minified and gzipped.
// The budget is for the runtime code. deeplinker.js, which `deeplinker build` writes, is that code plus the site's
// config, so its size depends on how much is configured; the build prints it for information.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const LIMIT = 6144;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["dist/deeplinker.iife.min.js", "dist/deeplinker.umd.js"];

let failed = false;
for (const file of files) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    console.error(`size-check: ${file} is missing; run the build first.`);
    process.exit(1);
  }
  const bytes = gzipSync(readFileSync(path), { level: 9 }).length;
  const ok = bytes <= LIMIT;
  failed ||= !ok;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${file.padEnd(30)} ${String(bytes).padStart(5)} B gzip (limit ${LIMIT}, ${ok ? LIMIT - bytes + " spare" : bytes - LIMIT + " over"})`,
  );
}
if (failed) {
  console.error(
    "\nThe runtime is over its size budget. Trim code or data before merging; do not raise the limit.",
  );
  process.exit(1);
}
