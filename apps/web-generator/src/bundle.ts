import { formatIssues, parseConfig, type ConfigIssue } from "@deeplinker/core";
import {
  fileDestination,
  generate,
  type DetectedHost,
  type ExistingFiles,
  type GeneratedFile,
} from "@deeplinker/generator";
import { makeZip } from "./zip";

/** The folder the ZIP unpacks to: the one `deeplinker build` writes by default. */
export const ZIP_FOLDER = "deeplinker-dist";

export type Bundle =
  | { ok: false; kind: "json"; message: string }
  | { ok: false; kind: "config"; issues: ConfigIssue[]; text: string }
  | {
      ok: true;
      files: GeneratedFile[];
      /** The build's warnings (the config's and the generator's), as `deeplinker build` prints them. */
      warnings: string[];
      notes: string[];
      hash: string;
      /** Every host name in the config. */
      domains: string[];
      host: DetectedHost;
      /** Where each file goes (Markdown, as in README-DEPLOY.md), by path. */
      destinations: Record<string, string>;
    };

/**
 * What `deeplinker build` would write for this config, minus the file system: same parser, same generator, same files.
 * `existing` holds the text of files you already have (the page cannot read your project), merged the way `build`
 * merges the ones it finds. No project is scanned, so `hosting: "auto"` means plain static hosting.
 */
export function buildBundle(json: string, existing: ExistingFiles = {}): Bundle {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, kind: "json", message: (error as Error).message };
  }
  const parsed = parseConfig(raw);
  if (!parsed.ok)
    return { ok: false, kind: "config", issues: parsed.errors, text: formatIssues(parsed.errors) };

  const kept: ExistingFiles = {};
  for (const [key, value] of Object.entries(existing) as [keyof ExistingFiles, string | undefined][]) {
    if (value !== undefined && value.trim() !== "") kept[key] = value;
  }
  const result = generate(parsed.config, { existing: kept, projectFiles: [] });
  return {
    ok: true,
    files: result.files,
    warnings: [...parsed.warnings, ...result.warnings],
    notes: result.notes,
    hash: result.hash,
    domains: parsed.config.domains,
    host: result.host,
    destinations: Object.fromEntries(result.files.map((f) => [f.path, fileDestination(f, parsed.config)])),
  };
}

/** The ZIP of a successful bundle: every file under `deeplinker-dist/`, exactly as `build` would have written it. */
export function zipBundle(bundle: Extract<Bundle, { ok: true }>): Uint8Array<ArrayBuffer> {
  return makeZip(bundle.files.map((f) => ({ path: `${ZIP_FOLDER}/${f.path}`, content: f.content })));
}
