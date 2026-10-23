import { BIN_NAME, HOSTING_IDS, formatIssues, parseConfig, type HostId } from "@deeplinker/core";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { appSnippets } from "./commands/app-snippets";
import { build } from "./commands/build";
import { runInit } from "./commands/init";
import { verify } from "./commands/verify";
import { loadConfig } from "./config-loader";
import { CliError } from "./errors";
import { colorEnabled, styler } from "./format";
import { clackPrompter, type Prompter } from "./prompts";
import { formatReport } from "./verify/report";

export interface CliDeps {
  cwd: string;
  /** Normal output. */
  log: (line: string) => void;
  /** Error output. */
  error: (line: string) => void;
  isTTY?: boolean;
  env?: Record<string, string | undefined>;
  /** Module aliases for the config file (the bin maps `@kalimulhaq/deeplinker` to its own copy). */
  alias?: Record<string, string>;
  prompter?: Prompter;
  version?: string;
}

const collect = (value: string, previous: string[]) => [...previous, value];

const milliseconds = (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new InvalidArgumentError("Use a number of milliseconds above 0, e.g. 5000.");
  return Math.round(n);
};

/**
 * Runs the CLI with `args` (without `node` and the script name) and returns the exit code instead of exiting:
 * 0 success; 1 a check failed or the command was misused; 2 the config could not be loaded or is invalid.
 */
export async function run(args: string[], deps: CliDeps): Promise<number> {
  const { cwd, log } = deps;
  const color = colorEnabled(deps.isTTY, deps.env ?? {});
  let exitCode = 0;

  const program = new Command()
    .name(BIN_NAME)
    .description("Turn any page on your site into a deep link: app, store, web app, or stay.")
    .version(deps.version ?? "0.0.0-dev")
    .exitOverride()
    .configureOutput({ writeOut: (s) => log(s.trimEnd()), writeErr: (s) => deps.error(s.trimEnd()) });

  program
    .command("init")
    .description("Create deeplinker.config.ts by answering a few questions.")
    .option("--yes", "skip the questions and write a minimal config (needs --domains)")
    .option("--domains <list>", "the host names your links use, comma separated")
    .option("--force", "replace an existing config file")
    .action(async (o: { yes?: boolean; domains?: string; force?: boolean }) => {
      await runInit({
        cwd,
        prompter: deps.prompter ?? clackPrompter,
        yes: o.yes,
        domains: o.domains,
        force: o.force,
        log,
      });
    });

  program
    .command("build")
    .description("Validate the config and write everything to deploy into the output directory.")
    .option("--config <file>", "config file (default: deeplinker.config.ts, .mts, .js, .mjs or .json)")
    .option("--out <dir>", "output directory (default: outDir from the config, or deeplinker-dist)")
    .addOption(new Option("--hosting <host>", "override the hosting setting").choices(HOSTING_IDS))
    .option("--dry-run", "show what would be written and write nothing")
    .action(async (o: { config?: string; out?: string; hosting?: HostId; dryRun?: boolean }) => {
      await build({
        cwd,
        config: o.config,
        out: o.out,
        hosting: o.hosting,
        dryRun: o.dryRun,
        alias: deps.alias,
        log,
        color,
      });
    });

  program
    .command("verify <url>")
    .description("Check the live deployment against your config. Exits 1 if anything fails.")
    .option("--config <file>", "config file")
    .option("--allow-http", "allow http:// (a local test server); the Apple and Google checks are skipped")
    .option(
      "--sample <path>",
      "a real page to fetch for wildcard paths (repeatable)",
      collect,
      [] as string[],
    )
    .option("--timeout <ms>", "per-request timeout in milliseconds", milliseconds)
    .option("--json", "print the report as JSON")
    .action(
      async (
        url: string,
        o: { config?: string; allowHttp?: boolean; sample: string[]; timeout?: number; json?: boolean },
      ) => {
        const parsed = parseConfig((await loadConfig(cwd, o.config, { alias: deps.alias })).raw);
        if (!parsed.ok) throw new CliError(formatIssues(parsed.errors));
        const report = await verify({
          url,
          config: parsed.config,
          allowHttp: o.allowHttp,
          sample: o.sample,
          timeoutMs: o.timeout,
        });
        log(o.json ? JSON.stringify(report, null, 2) : formatReport(report, styler(color)));
        if (!report.ok) exitCode = 1;
      },
    );

  program
    .command("app-snippets")
    .description("Print the setup each app needs, filled in from your config.")
    .option("--config <file>", "config file")
    .addOption(
      new Option("--platform <platform>", "only this platform").choices([
        "ios",
        "macos",
        "android",
        "windows",
        "linux",
      ]),
    )
    .action(async (o: { config?: string; platform?: "ios" | "macos" | "android" | "windows" | "linux" }) => {
      await appSnippets({ cwd, config: o.config, platform: o.platform, alias: deps.alias, log, color });
    });

  try {
    await program.parseAsync(args, { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode; // usage errors and --help/--version, already printed
    if (error instanceof CliError) {
      deps.error(error.message);
      return error.exitCode;
    }
    deps.error(`Unexpected error: ${(error as Error).message}`);
    if (deps.env?.DEBUG) deps.error((error as Error).stack ?? "");
    return 1;
  }
}
