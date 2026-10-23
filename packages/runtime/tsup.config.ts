import { defineConfig } from "tsup";

const common = {
  platform: "browser",
  target: "es2015",
  clean: false,
  dts: false,
  sourcemap: false,
  // Bundle the workspace packages: the published runtime has no dependencies.
  noExternal: [/^@deeplinker\//],
} as const;

// Terser squeezes a few percent more out of what esbuild emits; the runtime has a hard size budget.
// Only safe options: no `unsafe*` flags, nothing that assumes how the page's own objects behave.
const terser = {
  ecma: 2015,
  compress: { passes: 3 },
  mangle: { toplevel: true },
  // ASCII only: the file is served as-is, and a `.js` with no charset header must not turn `×` into mojibake.
  format: { comments: false, ascii_only: true },
} as const;

// UMD = an IIFE inside a small wrapper: esbuild has no UMD output of its own. The entry itself sets `window.DeepLinker`
// (the script-tag case), so the wrapper only has to hand the object to AMD and CommonJS loaders.
const umdBanner =
  '(function(f){typeof define=="function"&&define.amd?define([],f):typeof module=="object"&&module.exports?module.exports=f():f()})(function(){';

export default defineConfig([
  {
    ...common,
    entry: { "deeplinker.esm": "src/index.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".js" }),
    minify: false,
  },
  {
    ...common,
    entry: { "deeplinker.umd": "src/entries/umd.ts" },
    format: ["iife"],
    outExtension: () => ({ js: ".js" }),
    minify: "terser",
    terserOptions: terser,
    banner: { js: umdBanner },
    footer: { js: ";return window.DeepLinker})" },
  },
  {
    ...common,
    entry: { "deeplinker.iife.min": "src/entries/iife.ts" },
    format: ["iife"],
    outExtension: () => ({ js: ".js" }),
    minify: "terser",
    terserOptions: terser,
  },
]);
