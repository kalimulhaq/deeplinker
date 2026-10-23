import { formatIssues, parseConfig } from "@deeplinker/core";
import { renderAppSnippets, type AppSnippet } from "@deeplinker/generator";
import { loadConfig } from "../config-loader";
import { CliError } from "../errors";
import { styler } from "../format";

export interface AppSnippetsOptions {
  cwd: string;
  config?: string;
  /** Only this platform. */
  platform?: AppSnippet["platform"];
  alias?: Record<string, string>;
  log: (line: string) => void;
  color?: boolean;
}

/** Prints what each app needs, filled in from the config: entitlements, intent filter, manifest entry, `.desktop` line. */
export async function appSnippets(opts: AppSnippetsOptions): Promise<AppSnippet[]> {
  const s = styler(opts.color ?? false);
  const parsed = parseConfig((await loadConfig(opts.cwd, opts.config, { alias: opts.alias })).raw);
  if (!parsed.ok) throw new CliError(formatIssues(parsed.errors));

  const all = renderAppSnippets(parsed.config);
  const snippets = opts.platform ? all.filter((x) => x.platform === opts.platform) : all;
  if (!snippets.length) {
    opts.log(
      opts.platform
        ? `No ${opts.platform} app is configured. Add it under apps.${opts.platform} in your config.`
        : "No apps are configured yet. Add apps.ios, apps.android, apps.macos, apps.windows or apps.linux to your config.",
    );
    return [];
  }
  for (const snippet of snippets) {
    opts.log(s.bold(`${snippet.title}`));
    opts.log(`${s.dim("Where:")} ${snippet.where}`);
    opts.log("");
    opts.log(
      snippet.code
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
    opts.log("");
    opts.log(`${s.dim("Reading the URL:")} ${snippet.readUrl}`);
    for (const note of snippet.notes) opts.log(s.dim(`  · ${note}`));
    opts.log("");
  }
  return snippets;
}
