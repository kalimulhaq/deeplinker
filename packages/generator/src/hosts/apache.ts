import { markerBlock, mergeMarkerBlock } from "../merge/marker-block";
import type { HostContext, HostOutput } from "../types";

/**
 * `.htaccess` block: the extensionless association files get a JSON content type, and no later rewrite rule may
 * touch `/.well-known/`. The block goes first so it wins over a site's own rules. It is merged into the user's
 * `.htaccess`; their rules are not changed.
 */
export function renderApache({ wellKnown, existing, deferred }: HostContext): HostOutput {
  const extensionless = wellKnown
    .map((f) => f.path.split("/").pop() as string)
    .filter((n) => !n.endsWith(".json"));
  const lines = [
    "# Association files are served as JSON, from the domain root, never rewritten or sent elsewhere.",
  ];
  if (extensionless.length) {
    lines.push(
      "<IfModule mod_mime.c>",
      `  <FilesMatch "^(${extensionless.join("|")})$">`,
      "    ForceType application/json",
      "  </FilesMatch>",
      "</IfModule>",
    );
  }
  lines.push("<IfModule mod_rewrite.c>", "  RewriteEngine On", "  RewriteRule ^\\.well-known/ - [L]");
  if (deferred) {
    // The base path is limited to letters, digits and `._~-`, so the dot is the only character to escape.
    const path = deferred.basePath.slice(1).replace(/\./g, "\\.");
    lines.push(
      "  # Deferred deep linking: these two paths are answered by dl.php.",
      `  RewriteRule ^${path}/(click|match)$ dl.php [L]`,
    );
  }
  lines.push("</IfModule>");

  const block = markerBlock(lines);
  const content = mergeMarkerBlock(existing.htaccess, block, "top");
  return {
    files: [
      {
        path: ".htaccess",
        content,
        description: existing.htaccess
          ? "Your .htaccess with the deeplinker block added at the top (everything else unchanged)"
          : "Apache rules that serve the association files as JSON",
        destination: "the web root's `.htaccess`",
        before: existing.htaccess,
      },
    ],
    steps: [
      "Replace the web root's `.htaccess` with the generated one (or copy only the block between `# BEGIN deeplinker` and `# END deeplinker`).",
      "`mod_mime` and `mod_rewrite` must be enabled (they are on almost every host).",
      "If your own rules force `https` or `www`, make sure they let `/.well-known/` through, because Apple and Google reject a redirected association file.",
    ],
    notes: [],
    warnings: [],
  };
}
