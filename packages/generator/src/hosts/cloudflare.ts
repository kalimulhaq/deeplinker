import { RUNTIME_FILE } from "@deeplinker/core";
import { toJson } from "../util";
import type { HostContext, HostOutput } from "../types";
import { renderHeadersFile } from "./headers-file";

const EXCLUDE = ["/.well-known/*", `/${RUNTIME_FILE}`];

/**
 * `_routes.json` tells Cloudflare Pages which paths run Functions. The association files and `deeplinker.js` are static,
 * so they are excluded: they are then served directly, with no Function in between. An existing file is extended,
 * never replaced.
 */
function mergeRoutes(
  existingRoutes: string | undefined,
  deferred: HostContext["deferred"],
): { content: string; warning?: string } | null {
  // With the deferred endpoint there is a Function to run, and only for its two paths: no Function runs for a page view.
  const wanted = deferred ? [`${deferred.basePath}/*`] : [];
  if (existingRoutes === undefined)
    return { content: toJson({ version: 1, include: wanted.length ? wanted : ["/*"], exclude: EXCLUDE }) };
  try {
    const parsed: unknown = JSON.parse(existingRoutes);
    const o = parsed as { version?: unknown; include?: unknown; exclude?: unknown };
    if (typeof parsed !== "object" || parsed === null || o.version !== 1)
      throw new Error("not a version 1 file");
    const include = Array.isArray(o.include) ? (o.include as string[]) : ["/*"];
    const exclude = Array.isArray(o.exclude) ? (o.exclude as string[]) : [];
    // Already covered by a catch-all, or listed: nothing to add.
    const missing = include.includes("/*") ? [] : wanted.filter((w) => !include.includes(w));
    return {
      content: toJson({
        ...o,
        include: [...include, ...missing],
        exclude: [...exclude, ...EXCLUDE.filter((e) => !exclude.includes(e))],
      }),
    };
  } catch {
    return null;
  }
}

export function renderCloudflare(ctx: HostContext): HostOutput {
  const out: HostOutput = {
    files: [renderHeadersFile(ctx, "Cloudflare Pages")],
    steps: [
      "Put the generated `.well-known/` folder, `_headers` and `_routes.json` in the output directory Cloudflare Pages publishes.",
      "If you already have `_headers` or `_routes.json`, use the generated ones: your rules are kept and the deeplinker entries are added.",
      "Do not add a redirect rule that matches `/.well-known/*`.",
    ],
    notes: [],
    warnings: [],
  };

  const routes = mergeRoutes(ctx.existing.routesJson, ctx.deferred);
  if (routes) {
    out.files.push({
      path: "_routes.json",
      content: routes.content,
      description: ctx.existing.routesJson
        ? "Your _routes.json with the static files excluded from Functions"
        : ctx.deferred
          ? "Runs Pages Functions only for the deferred deep linking paths"
          : "Keeps the association files and deeplinker.js out of Pages Functions",
      destination: "the output directory Cloudflare Pages publishes",
      before: ctx.existing.routesJson,
    });
  } else {
    out.warnings.push(
      "_routes.json: your existing file is not a version 1 routes file, so it was left alone. Add `/.well-known/*` and `/deeplinker.js` to its `exclude` list by hand.",
    );
  }
  return out;
}
