import { markerBlock, mergeMarkerBlock } from "../merge/marker-block";
import type { GeneratedFile, HostContext } from "../types";

/** The `_headers` file shared by Netlify and Cloudflare Pages: a JSON content type for each association file. */
export function renderHeadersFile(
  { wellKnown, existing }: HostContext,
  host: "Netlify" | "Cloudflare Pages",
): GeneratedFile {
  const lines = ["# Association files are served as JSON."];
  for (const f of wellKnown) lines.push(`/${f.path}`, "  Content-Type: application/json");
  return {
    path: "_headers",
    content: mergeMarkerBlock(existing.headers, markerBlock(lines), "bottom"),
    description: existing.headers
      ? `Your _headers with the deeplinker block added at the end`
      : `${host} headers that serve the association files as JSON`,
    destination:
      host === "Netlify"
        ? "the publish directory (next to `index.html`)"
        : "the output directory Cloudflare Pages publishes",
    before: existing.headers,
  };
}
