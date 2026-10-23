import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate, type GenerateOptions } from "../src/generate";
import { FP, resolved } from "./helpers";

const TEMPLATE = 'var __c = "__DEEPLINKER_CONFIG__";';
const apps = {
  ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
  android: {
    packageName: "com.example.app",
    sha256CertFingerprints: [FP],
    stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
  },
};

function run(hosting: string, deferred: Record<string, unknown> | undefined, opts: GenerateOptions = {}) {
  return generate(
    resolved({ apps, hosting, ...(deferred ? { deferred: { enabled: true, ...deferred } } : {}) }),
    {
      runtimeTemplate: TEMPLATE,
      ...opts,
    },
  );
}
type Result = ReturnType<typeof run>;
const file = (r: Result, path: string) => r.files.find((f) => f.path === path);
const text = (r: Result, path: string) => file(r, path)?.content ?? "";
const paths = (r: Result) => r.files.map((f) => f.path);

const HOSTS = [
  "apache",
  "nginx",
  "vercel",
  "netlify",
  "cloudflare",
  "laravel",
  "wordpress",
  "static",
] as const;

describe("deferred deep linking is off unless asked for", () => {
  it.each(HOSTS)("%s: no endpoint, no routing, no README section", (host) => {
    const r = run(host, undefined);
    expect(paths(r).filter((p) => p.startsWith("deferred/"))).toEqual([]);
    expect(r.files.map((f) => f.content).join("\n")).not.toMatch(/dl\.php|\/dl\/click|api\/dl/);
    expect(text(r, "README-DEPLOY.md")).not.toContain("Deferred deep linking");
    expect(text(r, "deeplinker.js")).not.toContain('"deferred"');
  });
});

describe("the endpoint and the host rule that routes to it", () => {
  it("apache: PHP endpoint, and a rewrite for the two paths that comes before the site's own rules", () => {
    const r = run("apache", {});
    expect(file(r, "deferred/php/dl.php")?.destination).toBe("your web root, as dl.php");
    const htaccess = text(r, ".htaccess");
    expect(htaccess).toContain("RewriteRule ^dl/(click|match)$ dl.php [L]");
    expect(htaccess.indexOf("RewriteRule ^dl/")).toBeLessThan(htaccess.indexOf("# END deeplinker"));
  });

  it("apache: merges next to the user's rules and stays idempotent", () => {
    const existing = "RewriteEngine On\nRewriteRule ^(.*)$ index.php [L]\n";
    const first = text(run("apache", {}, { existing: { htaccess: existing } }), ".htaccess");
    expect(first.endsWith(existing)).toBe(true);
    expect(text(run("apache", {}, { existing: { htaccess: first } }), ".htaccess")).toBe(first);
  });

  it("nginx: proxies each path to the Node endpoint and overwrites X-Forwarded-For", () => {
    const r = run("nginx", {});
    expect(paths(r)).toContain("deferred/node/server.mjs");
    const conf = text(r, "nginx-deeplinker.conf");
    for (const action of ["click", "match"]) expect(conf).toContain(`location = /dl/${action} {`);
    expect(conf).toContain("proxy_pass http://127.0.0.1:3100;");
    expect(conf).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(conf).not.toContain("$proxy_add_x_forwarded_for");
    expect(conf).toContain("client_max_body_size 4k;");
  });

  it("vercel: three functions, and rewrites from the public paths to them", () => {
    const r = run("vercel", {});
    expect(paths(r)).toEqual(
      expect.arrayContaining([
        "deferred/vercel/lib/deeplinker.mjs",
        "deferred/vercel/api/dl/click.mjs",
        "deferred/vercel/api/dl/match.mjs",
      ]),
    );
    expect(JSON.parse(text(r, "vercel.json")).rewrites).toEqual([
      { source: "/dl/click", destination: "/api/dl/click" },
      { source: "/dl/match", destination: "/api/dl/match" },
    ]);
  });

  it("vercel: keeps your own rewrites, replaces only its own on a second run", () => {
    const mine = { source: "/old", destination: "/new" };
    const first = text(
      run("vercel", {}, { existing: { vercelJson: JSON.stringify({ rewrites: [mine] }) } }),
      "vercel.json",
    );
    const rewrites = JSON.parse(first).rewrites;
    expect(rewrites).toHaveLength(3);
    expect(rewrites[0]).toEqual(mine);
    expect(text(run("vercel", {}, { existing: { vercelJson: first } }), "vercel.json")).toBe(first);
  });

  it("vercel: a rewrite of yours for the same path is left where it is", () => {
    const yours = { source: "/dl/click", destination: "/somewhere-else" };
    const out = JSON.parse(
      text(
        run("vercel", {}, { existing: { vercelJson: JSON.stringify({ rewrites: [yours] }) } }),
        "vercel.json",
      ),
    );
    expect(out.rewrites[0]).toEqual(yours);
  });

  it("vercel: `rewrites` that is not an array is not guessed at", () => {
    const r = run("vercel", {}, { existing: { vercelJson: JSON.stringify({ rewrites: { a: 1 } }) } });
    expect(r.warnings.join("\n")).toContain("rewrites");
    expect(file(r, "vercel.json")).toBeUndefined();
    expect(JSON.parse(text(r, "vercel.deeplinker.json")).rewrites).toHaveLength(2);
  });

  it("netlify: the function claims its own paths, so no redirect rule is needed", () => {
    const r = run("netlify", {});
    const fn = text(r, "deferred/netlify/netlify/functions/dl.mjs");
    expect(fn).toContain('path: ["/dl/click", "/dl/match"]');
    expect(paths(r)).not.toContain("_redirects");
  });

  it("cloudflare: Functions run for the two paths only", () => {
    const r = run("cloudflare", {});
    expect(paths(r)).toContain("deferred/cloudflare/functions/dl/[[route]].js");
    expect(JSON.parse(text(r, "_routes.json"))).toEqual({
      version: 1,
      include: ["/dl/*"],
      exclude: ["/.well-known/*", "/deeplinker.js"],
    });
  });

  it("cloudflare: extends an existing include list, and leaves a catch-all alone", () => {
    const explicit = { version: 1, include: ["/api/*"], exclude: [] };
    const out = JSON.parse(
      text(run("cloudflare", {}, { existing: { routesJson: JSON.stringify(explicit) } }), "_routes.json"),
    );
    expect(out.include).toEqual(["/api/*", "/dl/*"]);
    const catchAll = { version: 1, include: ["/*"], exclude: [] };
    const kept = JSON.parse(
      text(run("cloudflare", {}, { existing: { routesJson: JSON.stringify(catchAll) } }), "_routes.json"),
    );
    expect(kept.include).toEqual(["/*"]);
  });

  it("laravel: routes outside the web group hand the paths to deeplinker/dl.php", () => {
    const r = run("laravel", {});
    expect(file(r, "deferred/php/dl.php")?.destination).toContain("deeplinker/dl.php");
    const routes = text(r, "laravel/routes/deeplinker.php");
    expect(routes).toContain("Route::any('/dl/click'");
    expect(routes).toContain("Route::any('/dl/match'");
    expect(routes).toContain("require base_path('deeplinker/dl.php');");
  });

  it("wordpress: the plugin answers the two paths, and the endpoint lives in a subfolder", () => {
    const r = run("wordpress", {});
    expect(file(r, "deferred/php/dl.php")?.destination).toContain("mu-plugins/deeplinker/dl.php");
    const plugin = text(r, "wordpress/deeplinker.php");
    expect(plugin).toContain("$path === '/dl/click' || $path === '/dl/match'");
    expect(plugin).toContain("require __DIR__ . '/deeplinker/dl.php';");
    expect(plugin).toContain("is_readable(");
  });

  it("static: the Node endpoint, with the steps to run and proxy it", () => {
    const r = run("static", {});
    expect(paths(r)).toContain("deferred/node/server.mjs");
    expect(text(r, "README-DEPLOY.md")).toContain("Proxy");
  });

  it.each(["apache", "nginx", "vercel", "netlify", "cloudflare", "laravel", "wordpress"] as const)(
    "%s: a different base path is used everywhere",
    (host) => {
      const r = run(host, { basePath: "/api/links" });
      const all = r.files.map((f) => f.content).join("\n");
      expect(all).toContain("/api/links/click");
      expect(all).not.toMatch(/['"= ]\/dl\/(click|match)/);
    },
  );
});

describe("storage", () => {
  it("each host picks its own default", () => {
    expect(text(run("cloudflare", {}), "deferred/cloudflare/functions/dl/[[route]].js")).toContain("kvStore");
    expect(text(run("vercel", {}), "deferred/vercel/lib/deeplinker.mjs")).toContain("redisStore");
    expect(text(run("nginx", {}), "deferred/node/server.mjs")).toContain("sqliteStore");
  });

  it("one that cannot work on the host is a warning, with no files and no routing", () => {
    const r = run("vercel", { storage: "sqlite" });
    expect(r.warnings.join("\n")).toContain('"sqlite" does not work with the vercel endpoint');
    expect(paths(r).filter((p) => p.startsWith("deferred/"))).toEqual([]);
    expect(JSON.parse(text(r, "vercel.json")).rewrites).toBeUndefined();
    expect(text(r, "README-DEPLOY.md")).not.toContain("Deferred deep linking");
  });

  it("memory storage on a host without shared memory warns that nothing will match", () => {
    expect(run("vercel", { storage: "memory" }).warnings.join("\n")).toContain("do not share memory");
  });
});

describe("what the visitor's browser and the deploy README say", () => {
  it("deeplinker.js reports clicks to the configured path", () => {
    expect(text(run("apache", {}), "deeplinker.js")).toContain('"deferred":{"url":"/dl/click"}');
    // The clipboard method is between the app and the endpoint: the browser is told nothing about it.
    expect(text(run("apache", { basePath: "/api/links", clipboard: true }), "deeplinker.js")).toContain(
      '"deferred":{"url":"/api/links/click"}',
    );
  });

  it("README-DEPLOY has a section with the steps, the privacy facts and the match kinds", () => {
    const readme = text(run("cloudflare", { ttlSeconds: 1800 }), "README-DEPLOY.md");
    expect(readme).toContain("## 7. Deferred deep linking");
    expect(readme).toContain("`POST /dl/click`");
    expect(readme).toContain("Storage: **kv**");
    expect(readme).toContain("DEEPLINKER_KV");
    expect(readme).toContain("for 30 minutes per click");
    expect(readme).toContain("never the full address");
    expect(readme).toContain("sets no cookie");
    expect(readme).toContain("The clipboard method is off.");
    expect(readme).toContain("`probabilistic`");
  });

  it("the README says so when the clipboard method is on", () => {
    expect(text(run("apache", { clipboard: true }), "README-DEPLOY.md")).toContain(
      "The clipboard method is on",
    );
  });

  it("is deterministic", () => {
    const a = run("vercel", {});
    const b = run("vercel", {});
    expect(a.files).toEqual(b.files);
    expect(a.hash).toBe(b.hash);
  });
});

describe("the PHP it writes parses", () => {
  const php = spawnSync("php", ["-v"]).status === 0;
  const check = (name: string, source: string) => {
    const dir = mkdtempSync(join(tmpdir(), "deeplinker-php-"));
    try {
      const path = join(dir, name);
      writeFileSync(path, source);
      const r = spawnSync("php", ["-l", path], { encoding: "utf8" });
      return { ok: r.status === 0, out: r.stdout + r.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.skipIf(!php).each([
    ["laravel", "laravel/routes/deeplinker.php"],
    ["wordpress", "wordpress/deeplinker.php"],
    ["apache", "deferred/php/dl.php"],
  ])("%s: %s", (host, path) => {
    const r = check("file.php", text(run(host, {}), path));
    expect(r.out).toContain("No syntax errors");
    expect(r.ok).toBe(true);
  });
});
