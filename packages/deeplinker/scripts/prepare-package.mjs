// After tsup: put the browser runtime builds and the license/readme next to the code that gets published.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(here, "../..");

mkdirSync(resolve(here, "dist/runtime"), { recursive: true });
for (const file of ["deeplinker.esm.js", "deeplinker.umd.js"]) {
  const from = resolve(repo, "packages/runtime/dist", file);
  if (!existsSync(from)) {
    console.error(
      `prepare-package: ${from} is missing. Build the runtime first (pnpm --filter @deeplinker/runtime build).`,
    );
    process.exit(1);
  }
  copyFileSync(from, resolve(here, "dist/runtime", file));
}

// The deferred deep linking contract, for anyone building an SDK or an app against the endpoint.
const openapi = resolve(repo, "packages/deferred/openapi.yaml");
if (existsSync(openapi)) copyFileSync(openapi, resolve(here, "dist/openapi.yaml"));
else
  console.warn(
    "prepare-package: packages/deferred/openapi.yaml not found; the package will ship without it.",
  );

for (const file of ["LICENSE", "README.md"]) {
  const from = resolve(repo, file);
  if (existsSync(from)) copyFileSync(from, resolve(here, file));
  else
    console.warn(
      `prepare-package: ${file} not found at the repository root; the package will ship without it.`,
    );
}
