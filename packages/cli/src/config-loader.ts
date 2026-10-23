import { CONFIG_FILE_NAMES } from "@deeplinker/core";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { CliError } from "./errors";

export interface LoadedConfig {
  /** Absolute path of the file that was loaded. */
  file: string;
  /** What it exports, before validation. */
  raw: unknown;
}

export interface LoadOptions {
  /**
   * Module aliases for the config file. The CLI maps `@kalimulhaq/deeplinker` to its own copy, so a config that imports
   * `defineConfig` loads even when the package is not installed in the project (for example under `npx`).
   */
  alias?: Record<string, string>;
}

function findConfig(cwd: string, explicit?: string): string {
  if (explicit) {
    const file = resolve(cwd, explicit);
    if (!existsSync(file)) throw new CliError(`Config file not found: ${explicit}`);
    return file;
  }
  for (const name of CONFIG_FILE_NAMES) {
    const file = resolve(cwd, name);
    if (existsSync(file)) return file;
  }
  throw new CliError(
    `No deeplinker config found in ${cwd}.\nRun \`npx deeplinker init\` to create deeplinker.config.ts, or pass --config <file>.`,
  );
}

/** Loads `deeplinker.config.ts|mts|js|mjs|json`. TypeScript is handled by jiti, with its on-disk cache switched off. */
export async function loadConfig(
  cwd: string,
  explicit?: string,
  options: LoadOptions = {},
): Promise<LoadedConfig> {
  const file = findConfig(cwd, explicit);
  const name = file.slice(file.lastIndexOf("/") + 1);

  if (file.endsWith(".json")) {
    try {
      return { file, raw: JSON.parse(readFileSync(file, "utf8")) as unknown };
    } catch (error) {
      throw new CliError(`${name} is not valid JSON: ${(error as Error).message}`);
    }
  }

  try {
    const jiti = createJiti(file, {
      fsCache: false,
      moduleCache: false,
      interopDefault: true,
      alias: options.alias,
    });
    const mod = (await jiti.import(file)) as { default?: unknown } | undefined;
    const raw = mod && typeof mod === "object" && "default" in mod ? mod.default : undefined;
    if (raw === undefined) {
      throw new Error("it has no default export. End the file with `export default defineConfig({ … })`.");
    }
    return { file, raw };
  } catch (error) {
    throw new CliError(`Could not load ${name}: ${(error as Error).message}`);
  }
}
