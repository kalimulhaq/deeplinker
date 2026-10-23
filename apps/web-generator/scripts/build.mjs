// Bundles the page into dist/: one classic script (so it also opens from a file:// URL), the HTML and the stylesheet.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, "src/main.ts")],
  outfile: resolve(dist, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});

copyFileSync(resolve(root, "index.html"), resolve(dist, "index.html"));
copyFileSync(resolve(root, "styles.css"), resolve(dist, "styles.css"));

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`web-generator: dist/ ready (app.js ${(bytes / 1024).toFixed(0)} KB)`);
