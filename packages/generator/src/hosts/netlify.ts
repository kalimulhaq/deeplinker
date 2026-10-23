import type { HostContext, HostOutput } from "../types";
import { renderHeadersFile } from "./headers-file";

export function renderNetlify(ctx: HostContext): HostOutput {
  return {
    files: [renderHeadersFile(ctx, "Netlify")],
    steps: [
      "Put the generated `.well-known/` folder and `_headers` in the directory Netlify publishes (your build's output directory, often `public/` or `dist/`).",
      "If you already have a `_headers` file, use the generated one: it keeps your rules and only adds the block between `# BEGIN deeplinker` and `# END deeplinker`.",
      "Do not add a `_redirects` rule that matches `/.well-known/*`.",
    ],
    notes: [],
    warnings: [],
  };
}
