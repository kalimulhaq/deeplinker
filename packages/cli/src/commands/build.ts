import { RUNTIME_FILE, formatIssues, parseConfig, type HostId } from "@deeplinker/core";
import { HOST_LABEL, generate, type DetectedHost } from "@deeplinker/generator";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { loadConfig } from "../config-loader";
import { renderDiff } from "../diff";
import { CliError } from "../errors";
import { formatBytes, styler } from "../format";
import { resolveOutDir, scanProject, writeFile } from "../fs-io";

export interface BuildOptions {
  cwd: string;
  /** `--config`. */
  config?: string;
  /** `--out`: overrides the config's outDir. */
  out?: string;
  /** `--hosting`: overrides the config's `hosting`. */
  hosting?: HostId;
  dryRun?: boolean;
  alias?: Record<string, string>;
  log: (line: string) => void;
  color?: boolean;
}

export interface BuildResult {
  outDir: string;
  /** Paths relative to outDir. */
  written: string[];
  warnings: string[];
  host: DetectedHost;
  /** Files that were merged into one of the user's own, with the diff against the original. */
  diffs: { path: string; source: string; diff: string }[];
  /** Every host name in the config. */
  domains: string[];
}

/** Validates the config, generates every file, writes them under outDir, and says what to do next. */
export async function build(opts: BuildOptions): Promise<BuildResult> {
  const s = styler(opts.color ?? false);
  const { log, cwd } = opts;

  const loaded = await loadConfig(cwd, opts.config, { alias: opts.alias });
  const parsed = parseConfig(loaded.raw);
  if (!parsed.ok) throw new CliError(formatIssues(parsed.errors));
  const config = parsed.config;

  const outDir = resolveOutDir(cwd, opts.out ?? config.outDir);
  const manifestPath = config.web?.pwa?.manifestPath ?? "/manifest.json";
  const scan = scanProject(cwd, manifestPath, outDir);
  const result = generate(config, {
    existing: scan.existing,
    projectFiles: scan.files,
    hosting: opts.hosting,
  });

  // An output folder that already holds files with the names we are about to write, and was not made by an earlier
  // build (that always leaves README-DEPLOY.md), is a folder of the user's own. Writing there would replace their
  // files, so say so instead.
  const outRel = relative(cwd, outDir) || ".";
  if (!existsSync(join(outDir, "README-DEPLOY.md"))) {
    const taken = result.files.map((f) => f.path).filter((p) => existsSync(join(outDir, p)));
    if (taken.length) {
      throw new CliError(
        `${outRel}/ already contains ${taken.join(", ")}, and it was not made by a previous deeplinker build, so writing there would replace your own files. ` +
          `Use an empty folder: set outDir to "deeplinker-dist" (or pass --out).`,
      );
    }
  }

  log(s.bold(`deeplinker build: ${config.domains.join(", ")}`));
  log("");
  for (const warning of [...parsed.warnings, ...result.warnings]) log(s.yellow(`⚠ ${warning}`));
  if (parsed.warnings.length + result.warnings.length) log("");

  const label = HOST_LABEL[result.host.id];
  log(
    `Host: ${s.bold(label)} ` +
      (result.host.detected
        ? s.dim(`(detected from ${result.host.evidence.join(", ")})`)
        : result.host.id === "static" && !opts.hosting && config.hosting === "auto"
          ? s.dim(
              "(nothing recognised; set `hosting` in the config if you use a platform listed in the README)",
            )
          : s.dim("(set in the config)")),
  );
  log("");

  log(
    opts.dryRun
      ? s.bold(`Dry run: would write ${result.files.length} files to ${outRel}/`)
      : s.bold(`Wrote ${result.files.length} files to ${outRel}/`),
  );
  const width = Math.max(...result.files.map((f) => f.path.length));
  for (const file of result.files) {
    log(`  ${s.cyan(file.path.padEnd(width))}  ${s.dim(file.description)}`);
    if (!opts.dryRun) writeFile(outDir, file.path, file.content);
  }

  const diffs: BuildResult["diffs"] = [];
  const sourceOf: Record<string, string | undefined> = {
    ".htaccess": scan.found.htaccess,
    "vercel.json": scan.found.vercelJson,
    _headers: scan.found.headers,
    "_routes.json": scan.found.routesJson,
  };
  for (const file of result.files) {
    if (file.before === undefined) continue;
    const source = sourceOf[file.path] ?? scan.found.manifest ?? file.path;
    diffs.push({ path: file.path, source, diff: renderDiff(file.before, file.content, s) });
  }
  if (diffs.length) {
    log("");
    log(s.bold("Merged into your own files. Your originals are untouched; review each change:"));
    for (const d of diffs) {
      log("");
      log(s.bold(`${d.path}`) + s.dim(`  (merged from ${d.source}; copy it over yours when you are happy)`));
      log(d.diff);
    }
  }
  for (const note of result.notes) log(s.dim(`  ${note}`));

  const js = result.files.find((f) => f.path === RUNTIME_FILE);
  if (js) {
    const gz = gzipSync(js.content, { level: 9 }).length;
    log("");
    log(
      `${RUNTIME_FILE}  ${formatBytes(gz)} gzip ${s.dim("(the runtime is about 5 KB; your config adds the rest)")}`,
    );
  }

  log("");
  log(s.bold("Next steps"));
  log(`  1. Upload the files as described in ${outRel}/README-DEPLOY.md`);
  log(
    "  2. npx deeplinker app-snippets   (the entitlement, intent filter and manifest entry each app needs)",
  );
  log("  3. Then check the live site:");
  log(`     npx deeplinker verify https://${config.domains[0]}`);

  return {
    outDir,
    written: result.files.map((f) => f.path),
    warnings: [...parsed.warnings, ...result.warnings],
    host: result.host,
    diffs,
    domains: config.domains,
  };
}
