import type { HostId } from "@deeplinker/core";

export interface DetectedHost {
  id: HostId;
  /** The project files that led to this choice. Empty when nothing was recognised. */
  evidence: string[];
  detected: boolean;
}

const baseName = (path: string) => (path.split("/").pop() ?? path).toLowerCase();

/** In priority order: a platform's own file beats a generic `.htaccess`, which Laravel and WordPress also ship. */
const RULES: readonly [HostId, (name: string) => boolean][] = [
  ["vercel", (n) => n === "vercel.json"],
  ["netlify", (n) => n === "netlify.toml"],
  ["cloudflare", (n) => /^wrangler\.(toml|json|jsonc)$/.test(n)],
  ["laravel", (n) => n === "artisan"],
  ["wordpress", (n) => n === "wp-config.php"],
  ["vercel", (n) => /^next\.config\.(js|mjs|cjs|ts|mts)$/.test(n)],
  ["apache", (n) => n === ".htaccess"],
  ["nginx", (n) => n === "nginx.conf"],
];

/** Picks a host from the names of the files in the project (the caller lists them; this does no I/O). */
export function detectHost(files: readonly string[]): DetectedHost {
  for (const [id, matches] of RULES) {
    if (!files.some((f) => matches(baseName(f)))) continue;
    const evidence = files.filter((f) => RULES.some(([other, test]) => other === id && test(baseName(f))));
    return { id, evidence, detected: true };
  }
  return { id: "static", evidence: [], detected: false };
}
