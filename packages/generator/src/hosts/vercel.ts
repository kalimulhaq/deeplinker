import { toJson } from "../util";
import type { HostContext, HostOutput, Json } from "../types";

const JSON_HEADER = [{ key: "Content-Type", value: "application/json" }];

/** The functions live in `api/dl/`, whatever the public base path is. */
const FUNCTION_PATH = "/api/dl";

/**
 * `vercel.json` headers that give the association files a JSON content type. An existing `vercel.json` keeps all of
 * its settings. For these exact paths only the `Content-Type` header is replaced, so a re-run never duplicates it and
 * any other header you set for the same path stays. With the deferred endpoint it also adds the two rewrites to its
 * functions; your own rewrites are untouched.
 */
export function renderVercel({ wellKnown, existing, deferred }: HostContext): HostOutput {
  const ours = wellKnown.map((f) => ({ source: `/${f.path}`, headers: JSON_HEADER }));
  const sources = new Set(ours.map((e) => e.source));
  const steps = [
    "Put the generated `.well-known/` folder in `public/` (Next.js and most frameworks) or at the root of the output directory Vercel publishes.",
    "Use the generated `vercel.json`, or copy its `headers` entries into your own.",
    "Do not add a catch-all redirect or rewrite that matches `/.well-known/*`.",
  ];
  const description = "Vercel headers that serve the association files as JSON";
  const rewrites = deferred
    ? ["click", "match"].map((a) => ({
        source: `${deferred.basePath}/${a}`,
        destination: `${FUNCTION_PATH}/${a}`,
      }))
    : [];
  const out: HostOutput = { files: [], steps, notes: [], warnings: [] };

  let json: Json = {};
  let separate = false;
  if (existing.vercelJson !== undefined) {
    try {
      const parsed: unknown = JSON.parse(existing.vercelJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("not an object");
      json = parsed as Json;
      if (json.headers !== undefined && !Array.isArray(json.headers))
        throw new Error("headers is not an array");
      if (rewrites.length && json.rewrites !== undefined && !Array.isArray(json.rewrites))
        throw new Error("rewrites is not an array");
    } catch {
      out.warnings.push(
        "vercel.json: your existing file could not be merged (it is not valid JSON, or `headers` or `rewrites` is not an array), so it was left alone. The rules are in vercel.deeplinker.json: copy them over by hand.",
      );
      json = {};
      separate = true;
    }
  }

  const kept: unknown[] = [];
  for (const entry of Array.isArray(json.headers) ? (json.headers as unknown[]) : []) {
    const e = entry as { source?: unknown; headers?: unknown } | null;
    const plain = e && Object.keys(e).length === 2 && Array.isArray(e.headers);
    if (!plain || !sources.has(e.source as string)) {
      kept.push(entry);
      continue;
    }
    const rest = (e.headers as { key?: unknown }[]).filter(
      (h) => String(h?.key).toLowerCase() !== "content-type",
    );
    if (rest.length) kept.push({ ...e, headers: rest });
  }
  json.headers = [...kept, ...ours];
  if (rewrites.length) {
    // Ours are recognised by source and destination together, so a re-run replaces them and a rewrite of yours is never touched.
    const key = (r: unknown) => {
      const e = r as { source?: unknown; destination?: unknown } | null;
      return `${String(e?.source)} ${String(e?.destination)}`;
    };
    const mine = new Set(rewrites.map(key));
    const others = Array.isArray(json.rewrites)
      ? (json.rewrites as unknown[]).filter((r) => !mine.has(key(r)))
      : [];
    json.rewrites = [...others, ...rewrites];
  }

  out.files.push({
    path: separate ? "vercel.deeplinker.json" : "vercel.json",
    content: toJson(json),
    description:
      separate || existing.vercelJson === undefined
        ? description
        : `Your vercel.json with the association-file headers added`,
    destination: separate
      ? "copy the `headers` entries into your `vercel.json`"
      : "the project root, next to `package.json`",
    before: separate ? undefined : existing.vercelJson,
  });
  return out;
}
