import { buildSnippet } from "../files/snippet";
import type { HostContext, HostOutput } from "../types";

/**
 * A must-use plugin: it answers `/.well-known/…` itself (so it works on Apache, nginx and managed hosts alike, with the
 * right content type and no redirect) and prints the script tag in every page's `<head>`.
 */
export function renderWordPress({ config, wellKnown, deferred }: HostContext): HostOutput {
  const { script } = buildSnippet(config);
  const lines = [
    "<?php",
    "/**",
    " * Plugin Name: Deeplinker",
    ` * Description: Serves the app association files for ${config.domains.join(", ")} and loads deeplinker.js.`,
    " */",
    "",
    "if (!defined('ABSPATH')) {",
    "    exit;",
    "}",
    "",
    "function deeplinker_files() {",
  ];
  const keys: string[] = [];
  wellKnown.forEach((f, i) => {
    lines.push(`    $file${i} = <<<'JSON'`, f.content.trimEnd(), "JSON;", "");
    keys.push(`        '/${f.path}' => $file${i},`);
  });
  lines.push(
    "    return array(",
    ...keys,
    "    );",
    "}",
    "",
    "add_action('init', function () {",
    "    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);",
    "    $files = deeplinker_files();",
    "    if (isset($files[$path])) {",
    "        status_header(200);",
    "        header('Content-Type: application/json');",
    "        header('Cache-Control: public, max-age=3600');",
    "        echo $files[$path];",
    "        exit;",
    "    }",
    "}, 0);",
    "",
    ...(deferred
      ? [
          "// Deferred deep linking: the endpoint is deeplinker/dl.php next to this file. It sits in a subfolder on purpose:",
          "// WordPress loads only the top-level files of mu-plugins, so the endpoint never runs by accident.",
          "add_action('init', function () {",
          "    $path = rtrim((string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');",
          `    if (($path === '${deferred.basePath}/click' || $path === '${deferred.basePath}/match') && is_readable(__DIR__ . '/deeplinker/dl.php')) {`,
          "        require __DIR__ . '/deeplinker/dl.php';",
          "        exit;",
          "    }",
          "}, 0);",
          "",
        ]
      : []),
    "add_action('wp_head', function () {",
    "    echo <<<'HTML'",
    script,
    "HTML;",
    "}, 1);",
    "",
  );
  return {
    files: [
      {
        path: "wordpress/deeplinker.php",
        content: lines.join("\n"),
        description: deferred
          ? "WordPress must-use plugin: serves the association files, answers the deferred deep linking paths and prints the head snippet"
          : "WordPress must-use plugin: serves the association files and prints the head snippet",
        destination: "`wp-content/mu-plugins/deeplinker.php`",
      },
    ],
    steps: [
      "Copy `wordpress/deeplinker.php` to `wp-content/mu-plugins/` (create the folder if it does not exist). Must-use plugins load automatically.",
      "Copy `deeplinker.js` to the site root, next to `wp-config.php`, so it is served at `/deeplinker.js`.",
      "You do not need to edit your theme: the plugin prints the script in every page's `<head>`.",
      "If a caching plugin or CDN caches 404s, purge `/.well-known/*` after installing.",
    ],
    notes: [],
    warnings: [],
  };
}
