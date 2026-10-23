import { PACKAGE_NAME } from "@deeplinker/core";
import { run } from "@deeplinker/cli";
import { fileURLToPath } from "node:url";

declare const __KIT_VERSION__: string;

// A config that does `import { defineConfig } from "@kalimulhaq/deeplinker"` resolves to this very copy, so it loads
// even when the package is not installed in the project (for example when run with npx).
const ownEntry = fileURLToPath(new URL("./index.js", import.meta.url));

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  isTTY: process.stdout.isTTY,
  env: process.env,
  alias: { [PACKAGE_NAME]: ownEntry },
  version: __KIT_VERSION__,
});
