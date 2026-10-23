import type { HostContext, HostOutput } from "../types";

/**
 * One exact-match `location` per file. An exact match beats the regex rules that many configs use to hide dotfiles
 * (`location ~ /\.`), so `/.well-known/` stays reachable.
 */
export function renderNginx({ config, wellKnown, deferred }: HostContext): HostOutput {
  const lines = [
    `# Association files for ${config.domains.join(", ")}, served as JSON and never rewritten or sent elsewhere.`,
    "# Include this inside the server { } block that serves the domain, for example:",
    "#   include /etc/nginx/snippets/nginx-deeplinker.conf;",
    "# The server's `root` must be the directory that contains .well-known/.",
    "",
  ];
  for (const f of wellKnown) {
    lines.push(
      `location = /${f.path} {`,
      "    default_type application/json;",
      "    try_files $uri =404;",
      "}",
      "",
    );
  }
  if (deferred) {
    lines.push(
      "# Deferred deep linking: the Node endpoint (deferred/node/server.mjs) listens on 127.0.0.1:3100.",
      "# X-Forwarded-For is replaced, not appended to, so a visitor cannot choose the address that is recorded.",
    );
    for (const action of ["click", "match"]) {
      lines.push(
        `location = ${deferred.basePath}/${action} {`,
        "    client_max_body_size 4k;",
        "    proxy_pass http://127.0.0.1:3100;",
        "    proxy_set_header Host $host;",
        "    proxy_set_header X-Forwarded-For $remote_addr;",
        "}",
        "",
      );
    }
  }
  return {
    files: [
      {
        path: "nginx-deeplinker.conf",
        content: lines.join("\n"),
        description: deferred
          ? "nginx locations that serve the association files as JSON and proxy the deferred deep linking paths"
          : "nginx locations that serve the association files as JSON",
        destination: "your nginx config (`include` it inside the `server` block)",
      },
    ],
    steps: [
      "Copy `nginx-deeplinker.conf` to the server (for example `/etc/nginx/snippets/`) and `include` it inside the `server { }` block for each domain.",
      "Reload with `nginx -t && nginx -s reload`.",
      "If the server also forces `https` or `www`, do it in a separate `server` block that only does that; the association files must be served by the final host without a hop.",
    ],
    notes: [],
    warnings: [],
  };
}
