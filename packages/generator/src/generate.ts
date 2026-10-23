import {
  AASA_PATH,
  ASSETLINKS_PATH,
  DEFAULT_MANIFEST_PATH,
  PACKAGE_NAME,
  RUNTIME_FILE,
  WINDOWS_LINK_PATH,
  configHash,
  toRuntimeConfig,
  type HostId,
  type ResolvedConfig,
  type RuntimeConfig,
} from "@deeplinker/core";
import { renderDeferred } from "@deeplinker/deferred/templates";
import { renderAppSnippetsMarkdown, renderAppSnippets } from "./files/app-snippets";
import { buildAasa } from "./files/aasa";
import { buildAssetlinks } from "./files/assetlinks";
import { renderDeployReadme } from "./files/deploy-readme";
import { buildManifestFragment } from "./files/manifest";
import { renderSnippetHtml } from "./files/snippet";
import { buildWindowsLink } from "./files/windows";
import { renderHost } from "./hosts";
import { detectHost, type DetectedHost } from "./hosts/detect";
import { mergeManifest } from "./merge/manifest";
import { RUNTIME_TEMPLATE } from "./runtime-template.generated";
import type { ExistingFiles, GeneratedFile, Json, WellKnownFile } from "./types";
import { toJson } from "./util";

export interface GenerateOptions {
  /** The runtime IIFE with the `"__DEEPLINKER_CONFIG__"` placeholder. Defaults to the one built into this package. */
  runtimeTemplate?: string;
  /** The user's own files, so they can be merged instead of replaced. */
  existing?: ExistingFiles;
  /** Overrides `config.hosting`. */
  hosting?: HostId;
  /** Names of the files in the project, for `hosting: "auto"`. */
  projectFiles?: string[];
}

export interface GenerateResult {
  files: GeneratedFile[];
  warnings: string[];
  /** What was merged or kept, in plain language. */
  notes: string[];
  /** Identifies this config's runtime; also in the first line of deeplinker.js. `verify` compares it. */
  hash: string;
  host: DetectedHost;
}

const PLACEHOLDER = '"__DEEPLINKER_CONFIG__"';

function renderRuntime(
  template: string,
  runtimeConfig: RuntimeConfig,
  hash: string,
  warnings: string[],
): string {
  const banner = `/*! ${PACKAGE_NAME} config:${hash} */\n`;
  if (!template) {
    warnings.push(
      "The browser runtime is not built into this copy of the generator (run `pnpm --filter @deeplinker/runtime build`), so deeplinker.js is only a stub.",
    );
    return banner + "/* runtime not built */\n";
  }
  if (!template.includes(PLACEHOLDER)) {
    warnings.push(
      "The runtime template has no config placeholder, so deeplinker.js was written without your configuration.",
    );
  }
  // Everything outside printable ASCII is escaped: `<` so the JSON can never hold a literal `</script` if someone
  // inlines the file in a page, and the rest so the file parses on engines before ES2019 (a raw U+2028 inside a string
  // is a syntax error there) and reads the same whatever charset the server announces for `.js`.
  const json = JSON.stringify(runtimeConfig).replace(
    /[<\u007f-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  return banner + template.split(PLACEHOLDER).join(json);
}

function parseObject(raw: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

/**
 * Config → files. Pure: no file system, no network, no clock, so the same input always gives the same output and
 * the web generator can run it in a browser. The caller reads the user's existing files (`opts.existing`) and decides
 * what to write; files that were merged into one of the user's own come back with their original in `before`.
 */
export function generate(config: ResolvedConfig, opts: GenerateOptions = {}): GenerateResult {
  const files: GeneratedFile[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const existing = opts.existing ?? {};
  const wellKnown: WellKnownFile[] = [];

  const addWellKnown = (path: string, value: Json | Json[] | null, description: string, built: string[]) => {
    warnings.push(...built);
    if (!value) return;
    const content = toJson(value);
    wellKnown.push({ path, content });
    files.push({ path, content, description });
  };

  const aasa = buildAasa(config);
  addWellKnown(
    AASA_PATH,
    aasa.value,
    "Apple Universal Links: which paths open your iOS, iPadOS and macOS apps",
    aasa.warnings,
  );
  const assetlinks = buildAssetlinks(config);
  addWellKnown(
    ASSETLINKS_PATH,
    assetlinks.value,
    "Android App Links: your package names and signing certificates",
    assetlinks.warnings,
  );
  const windows = buildWindowsLink(config);
  addWellKnown(
    WINDOWS_LINK_PATH,
    windows.value,
    "Windows web-to-app linking: your package family name and paths",
    windows.warnings,
  );

  const fragment = buildManifestFragment(config);
  if (fragment.value) {
    const manifestPath = (config.web?.pwa?.manifestPath ?? DEFAULT_MANIFEST_PATH).replace(/^\//, "");
    const parsed = existing.manifest === undefined ? null : parseObject(existing.manifest);
    if (existing.manifest !== undefined && !parsed) {
      warnings.push(
        `manifest: your existing manifest is not a valid JSON object, so it was left alone. The members to add are in manifest.fragment.json.`,
      );
    }
    if (parsed) {
      const merge = mergeManifest(parsed, fragment.value);
      files.push({
        path: manifestPath,
        content: toJson(merge.merged),
        description:
          "Your web app manifest with the related native apps added (your own fields are unchanged)",
        destination: `\`${manifestPath}\`, replacing your manifest`,
        before: existing.manifest,
      });
      notes.push(
        merge.added.length
          ? `manifest: added ${merge.added.join(", ")} to your existing manifest.`
          : "manifest: your manifest already had everything, so nothing was added.",
        ...merge.conflicts.map((c) => `manifest: ${c}`),
      );
    } else {
      files.push({
        path: "manifest.fragment.json",
        content: toJson(fragment.value),
        description: "Web app manifest members for your native apps",
      });
    }
  }

  const runtimeConfig = toRuntimeConfig(config);
  const hash = configHash(runtimeConfig);
  files.push({
    path: RUNTIME_FILE,
    content: renderRuntime(opts.runtimeTemplate ?? RUNTIME_TEMPLATE, runtimeConfig, hash, warnings),
    description: "The browser script that routes each visitor (your config is inlined)",
  });
  files.push({
    path: "snippet.html",
    content: renderSnippetHtml(config),
    description: "The script tag to paste into your pages' <head>",
  });

  const requested = opts.hosting ?? (config.hosting === "auto" ? undefined : config.hosting);
  const host: DetectedHost = requested
    ? { id: requested, evidence: [], detected: false }
    : detectHost(opts.projectFiles ?? []);

  // Deferred deep linking: the endpoint for this host, and (below) the host rule that routes its two paths to it.
  const deferred = config.deferred.enabled
    ? renderDeferred({
        host: host.id,
        storage: config.deferred.storage,
        settings: {
          hosts: config.domains,
          ttlSeconds: config.deferred.ttlSeconds,
          clipboard: config.deferred.clipboard,
          basePath: config.deferred.basePath,
        },
      })
    : undefined;
  if (deferred) {
    files.push(...deferred.files);
    warnings.push(...deferred.warnings);
  }
  const routing = deferred && deferred.files.length ? { basePath: config.deferred.basePath } : undefined;

  let hostSteps: string[] = [];
  if (wellKnown.length || routing) {
    const rendered = renderHost(host.id, { config, wellKnown, existing, deferred: routing });
    files.push(...rendered.files);
    hostSteps = rendered.steps;
    notes.push(...rendered.notes);
    warnings.push(...rendered.warnings);
  }

  const appSnippets = renderAppSnippets(config);
  const readme = renderDeployReadme({
    config,
    files: [
      ...files,
      ...(appSnippets.length
        ? [
            {
              path: "app-snippets.md",
              content: "",
              description: "The entitlement, intent filter and manifest entry each app needs",
            },
          ]
        : []),
    ],
    host,
    hostSteps: hostSteps.length ? hostSteps : renderHost("static", { config, wellKnown, existing }).steps,
    deferred: deferred && deferred.files.length ? deferred : undefined,
    warnings,
    notes,
  });
  files.push({
    path: "README-DEPLOY.md",
    content: readme,
    description: "What to upload where, for this config",
  });
  if (appSnippets.length) {
    files.push({
      path: "app-snippets.md",
      content: renderAppSnippetsMarkdown(config),
      description: "The entitlement, intent filter and manifest entry each app needs",
    });
  }

  return { files, warnings, notes, hash, host };
}
