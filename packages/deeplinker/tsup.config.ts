import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// The internal workspaces (core, generator, runtime, cli) are bundled into this one package. Third-party
// packages stay as dependencies, so they are installed rather than copied.
// Declarations must not point at packages that are not published, so their types are inlined too. The workspaces
// resolve through node_modules symlinks, which the declaration bundler treats as external libraries; mapping them to
// their source files makes it treat them as part of this package.
const DTS = {
  compilerOptions: {
    baseUrl: ".",
    paths: {
      "@deeplinker/core": ["../core/src/index.ts"],
      "@deeplinker/core/runtime": ["../core/src/runtime.ts"],
      "@deeplinker/generator": ["../generator/src/index.ts"],
      "@deeplinker/runtime": ["../runtime/src/index.ts"],
      "@deeplinker/deferred": ["../deferred/src/index.ts"],
    },
  },
};

const common = {
  target: "node18",
  platform: "node",
  noExternal: [/^@deeplinker\//],
  sourcemap: false,
  clean: false,
} as const;

export default defineConfig([
  { ...common, entry: { index: "src/index.ts" }, format: ["esm", "cjs"], dts: DTS },
  {
    ...common,
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    define: { __KIT_VERSION__: JSON.stringify(version) },
  },
  // `@kalimulhaq/deeplinker/deferred`: the request handler the generated endpoints import. No Node-only code, so it runs
  // on Cloudflare, Vercel, Netlify and Node alike.
  {
    ...common,
    entry: { deferred: "src/deferred.ts" },
    format: ["esm"],
    platform: "neutral",
    target: "es2022",
    dts: DTS,
  },
  // Types for `@kalimulhaq/deeplinker/runtime`; the JavaScript is copied from the runtime build by scripts/prepare-package.mjs.
  {
    ...common,
    entry: { "runtime/index": "src/runtime.ts" },
    format: ["esm"],
    dts: { only: true, ...DTS },
  },
]);
