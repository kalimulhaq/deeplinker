import type { HostContext, HostOutput } from "../types";

const VARIABLE: Record<string, string> = {
  "apple-app-site-association": "aasa",
  "assetlinks.json": "assetlinks",
  "windows-app-web-link": "windows",
};

/**
 * Serves the association files from Laravel routes. Registered outside the `web` group on purpose: that group starts
 * a session and sets cookies, which has no place on `/.well-known/`. The JSON is embedded, so nothing has to exist in
 * `public/`.
 */
export function renderLaravel({ config, wellKnown, deferred }: HostContext): HostOutput {
  const lines = [
    "<?php",
    "",
    `// Association files for ${config.domains.join(", ")}, served by Laravel as JSON.`,
    "//",
    "// Laravel 11+: register this file in bootstrap/app.php, outside the web middleware group:",
    "//     ->withRouting(",
    "//         web: __DIR__.'/../routes/web.php',",
    "//         then: function () {",
    "//             require base_path('routes/deeplinker.php');",
    "//         },",
    "//     )",
    "// Laravel 10 and older: in RouteServiceProvider::boot(), add",
    "//     Route::group([], base_path('routes/deeplinker.php'));",
    "//",
    "// Then copy deeplinker.js to public/.",
    "",
    "use Illuminate\\Support\\Facades\\Route;",
    "",
  ];
  for (const f of wellKnown) {
    const name = f.path.split("/").pop() as string;
    const variable = VARIABLE[name] ?? name.replace(/\W/g, "_");
    lines.push(`$${variable} = <<<'JSON'`, f.content.trimEnd(), "JSON;", "");
  }
  for (const f of wellKnown) {
    const name = f.path.split("/").pop() as string;
    const variable = VARIABLE[name] ?? name.replace(/\W/g, "_");
    lines.push(
      `Route::get('/${f.path}', function () use ($${variable}) {`,
      `    return response($${variable}, 200, ['Content-Type' => 'application/json', 'Cache-Control' => 'public, max-age=3600']);`,
      "});",
      "",
    );
  }
  if (deferred) {
    lines.push(
      "// Deferred deep linking: the endpoint is deeplinker/dl.php in the project root, outside public/. Because these",
      "// routes are outside the `web` group there is no session, no CSRF check and no cookie.",
    );
    for (const action of ["click", "match"]) {
      lines.push(
        `Route::any('${deferred.basePath}/${action}', function () {`,
        "    require base_path('deeplinker/dl.php');",
        "});",
        "",
      );
    }
  }
  return {
    files: [
      {
        path: "laravel/routes/deeplinker.php",
        content: lines.join("\n"),
        description: deferred
          ? "Laravel routes that serve the association files as JSON and hand the deferred deep linking paths to the endpoint"
          : "Laravel routes that serve the association files as JSON",
        destination: "`routes/deeplinker.php` in your Laravel project",
      },
    ],
    steps: [
      "Copy `laravel/routes/deeplinker.php` to `routes/deeplinker.php` and register it as described at the top of the file (outside the `web` group).",
      "Copy `deeplinker.js` to `public/deeplinker.js`.",
      "Paste `snippet.html` into your layout's `<head>`.",
      "Do not also put copies of the `.well-known` files in `public/`; the routes are the source of truth.",
    ],
    notes: [],
    warnings: [],
  };
}
