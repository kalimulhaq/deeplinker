import { describe, expect, it } from "vitest";
import { generate, type GenerateOptions } from "../src/generate";
import { detectHost } from "../src/hosts/detect";
import { mergeMarkerBlock, markerBlock } from "../src/merge/marker-block";
import { FP, resolved } from "./helpers";

const TEMPLATE = 'var __c = "__DEEPLINKER_CONFIG__";';
const apps = {
  ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
  android: {
    packageName: "com.example.app",
    sha256CertFingerprints: [FP],
    stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
  },
  windows: { packageFamilyName: "Example_abc123xyz" },
};

function run(hosting: string, opts: GenerateOptions = {}, extra: Record<string, unknown> = {}) {
  return generate(resolved({ apps, hosting, ...extra }), { runtimeTemplate: TEMPLATE, ...opts });
}
const file = (r: ReturnType<typeof run>, path: string) => r.files.find((f) => f.path === path);
const text = (r: ReturnType<typeof run>, path: string) => file(r, path)?.content ?? "";

describe("detectHost", () => {
  it.each([
    [["vercel.json", "package.json"], "vercel", ["vercel.json"]],
    [["netlify.toml"], "netlify", ["netlify.toml"]],
    [["wrangler.toml"], "cloudflare", ["wrangler.toml"]],
    [["wrangler.jsonc"], "cloudflare", ["wrangler.jsonc"]],
    [["artisan", "public/.htaccess"], "laravel", ["artisan"]],
    [["wp-config.php", ".htaccess"], "wordpress", ["wp-config.php"]],
    [["next.config.mjs"], "vercel", ["next.config.mjs"]],
    [["next.config.ts"], "vercel", ["next.config.ts"]],
    [["public/.htaccess"], "apache", ["public/.htaccess"]],
    [[".htaccess"], "apache", [".htaccess"]],
    [["nginx.conf"], "nginx", ["nginx.conf"]],
  ])("%j → %s", (files, id, evidence) => {
    expect(detectHost(files)).toEqual({ id, evidence, detected: true });
  });

  it("falls back to static and says nothing was detected", () => {
    expect(detectHost([])).toEqual({ id: "static", evidence: [], detected: false });
    expect(detectHost(["index.html", "package.json"])).toEqual({
      id: "static",
      evidence: [],
      detected: false,
    });
  });

  it("reports every file that supports the choice", () => {
    expect(detectHost(["vercel.json", "next.config.js"])).toEqual({
      id: "vercel",
      evidence: ["vercel.json", "next.config.js"],
      detected: true,
    });
  });

  it("an explicit platform file beats a generic .htaccess", () => {
    expect(detectHost([".htaccess", "netlify.toml"]).id).toBe("netlify");
  });

  it("explicit hosting beats detection, and generate() reports what it used", () => {
    const r = run("nginx", { projectFiles: ["vercel.json"] });
    expect(r.host).toEqual({ id: "nginx", evidence: [], detected: false });
    const auto = run("auto", { projectFiles: ["vercel.json"] });
    expect(auto.host).toEqual({ id: "vercel", evidence: ["vercel.json"], detected: true });
  });
});

describe("marker blocks", () => {
  const block = markerBlock(["a", "b"]);

  it("wraps lines in BEGIN/END markers", () => {
    expect(block).toBe("# BEGIN deeplinker\na\nb\n# END deeplinker\n");
  });

  it("adds a block to a file that has none, at the top or the bottom", () => {
    expect(mergeMarkerBlock("user\n", block, "top")).toBe(block + "\nuser\n");
    expect(mergeMarkerBlock("user\n", block, "bottom")).toBe("user\n\n" + block);
    expect(mergeMarkerBlock(undefined, block, "top")).toBe(block);
  });

  it("replaces its own block instead of duplicating it", () => {
    const once = mergeMarkerBlock("user\n", block, "top");
    const next = markerBlock(["c"]);
    const twice = mergeMarkerBlock(once, next, "top");
    expect(twice).toBe(next + "\nuser\n");
    expect(twice.match(/BEGIN deeplinker/g)).toHaveLength(1);
    expect(mergeMarkerBlock(twice, next, "top")).toBe(twice);
  });

  it("keeps everything around the block byte for byte", () => {
    const user = "before\n\n# BEGIN deeplinker\nold\n# END deeplinker\n\nafter  \n";
    expect(mergeMarkerBlock(user, markerBlock(["new"]), "top")).toBe(
      "before\n\n# BEGIN deeplinker\nnew\n# END deeplinker\n\nafter  \n",
    );
  });
});

describe("apache", () => {
  it("forces application/json for the extensionless files and keeps rewrites off .well-known", () => {
    const htaccess = text(run("apache"), ".htaccess");
    expect(htaccess).toContain("# BEGIN deeplinker");
    expect(htaccess).toContain("# END deeplinker");
    expect(htaccess).toMatch(
      /<FilesMatch "\^\(apple-app-site-association\|windows-app-web-link\)\$">\s+ForceType application\/json/,
    );
    expect(htaccess).toContain("RewriteRule ^\\.well-known/ - [L]");
  });

  it("merges into an existing .htaccess, keeping it and putting the block first", () => {
    const existing = "RewriteEngine On\nRewriteRule ^old$ /new [R=301,L]\n";
    const out = file(run("apache", { existing: { htaccess: existing } }), ".htaccess");
    expect(out?.before).toBe(existing);
    expect(out?.content.endsWith(existing)).toBe(true);
    expect(out?.content.startsWith("# BEGIN deeplinker")).toBe(true);
  });

  it("is idempotent", () => {
    const first = text(run("apache"), ".htaccess");
    expect(text(run("apache", { existing: { htaccess: first } }), ".htaccess")).toBe(first);
  });
});

describe("nginx", () => {
  it("serves each association file as JSON from an exact location", () => {
    const conf = text(run("nginx"), "nginx-deeplinker.conf");
    for (const name of ["apple-app-site-association", "assetlinks.json", "windows-app-web-link"]) {
      expect(conf).toContain(`location = /.well-known/${name} {`);
    }
    expect(conf).toContain("default_type application/json;");
  });
});

describe("vercel", () => {
  const user = {
    cleanUrls: true,
    redirects: [{ source: "/old", destination: "/new", permanent: true }],
    headers: [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
  };

  it("writes a vercel.json with JSON headers for each association file", () => {
    const json = JSON.parse(text(run("vercel"), "vercel.json"));
    expect(json.headers.map((h: { source: string }) => h.source)).toEqual([
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
      "/.well-known/windows-app-web-link",
    ]);
    expect(json.headers[0].headers).toEqual([{ key: "Content-Type", value: "application/json" }]);
  });

  it("keeps the user's headers, redirects and settings", () => {
    const existing = JSON.stringify(user, null, 2);
    const out = file(run("vercel", { existing: { vercelJson: existing } }), "vercel.json");
    const json = JSON.parse(out?.content ?? "");
    expect(out?.before).toBe(existing);
    expect(json.cleanUrls).toBe(true);
    expect(json.redirects).toEqual(user.redirects);
    expect(json.headers[0]).toEqual(user.headers[0]);
    expect(json.headers).toHaveLength(4);
  });

  it("replaces its own entries on a second run instead of duplicating them", () => {
    const first = text(run("vercel", { existing: { vercelJson: JSON.stringify(user) } }), "vercel.json");
    const second = text(run("vercel", { existing: { vercelJson: first } }), "vercel.json");
    expect(JSON.parse(second).headers).toHaveLength(4);
    expect(second).toBe(first);
  });

  it("keeps your other headers for the same path, and only swaps the Content-Type", () => {
    const mine = {
      source: "/.well-known/assetlinks.json",
      headers: [
        { key: "Cache-Control", value: "public, max-age=3600" },
        { key: "content-type", value: "text/plain" },
      ],
    };
    const first = text(
      run("vercel", { existing: { vercelJson: JSON.stringify({ headers: [mine] }) } }),
      "vercel.json",
    );
    const headers = JSON.parse(first).headers as {
      source: string;
      headers: { key: string; value: string }[];
    }[];
    const forPath = headers.filter((h) => h.source === mine.source);
    expect(forPath.flatMap((h) => h.headers)).toEqual([
      { key: "Cache-Control", value: "public, max-age=3600" },
      { key: "Content-Type", value: "application/json" },
    ]);
    expect(text(run("vercel", { existing: { vercelJson: first } }), "vercel.json")).toBe(first);
  });

  it("leaves an entry with extra conditions (has, missing) alone", () => {
    const conditional = {
      source: "/.well-known/assetlinks.json",
      has: [{ type: "host", value: "example.com" }],
      headers: [{ key: "X-Test", value: "1" }],
    };
    const out = JSON.parse(
      text(
        run("vercel", { existing: { vercelJson: JSON.stringify({ headers: [conditional] }) } }),
        "vercel.json",
      ),
    );
    expect(out.headers[0]).toEqual(conditional);
  });

  it("does not guess at a vercel.json it cannot parse: warns and writes a separate file", () => {
    const r = run("vercel", { existing: { vercelJson: "{ not json" } });
    expect(r.warnings.join("\n")).toContain("vercel.json");
    expect(file(r, "vercel.json")).toBeUndefined();
    expect(file(r, "vercel.deeplinker.json")).toBeDefined();
  });
});

describe("netlify and cloudflare", () => {
  it("netlify writes _headers rules for each association file", () => {
    const headers = text(run("netlify"), "_headers");
    expect(headers).toContain("/.well-known/apple-app-site-association\n  Content-Type: application/json");
    expect(headers).toContain("/.well-known/assetlinks.json\n  Content-Type: application/json");
  });

  it("keeps existing _headers rules and replaces its own block on a second run", () => {
    const existing = "/*\n  X-Robots-Tag: noindex\n";
    const first = text(run("netlify", { existing: { headers: existing } }), "_headers");
    expect(first.startsWith(existing)).toBe(true);
    const second = text(run("netlify", { existing: { headers: first } }), "_headers");
    expect(second).toBe(first);
    expect(second.match(/BEGIN deeplinker/g)).toHaveLength(1);
  });

  it("cloudflare writes _headers and a _routes.json that keeps static files out of Functions", () => {
    const r = run("cloudflare");
    expect(text(r, "_headers")).toContain(
      "/.well-known/windows-app-web-link\n  Content-Type: application/json",
    );
    expect(JSON.parse(text(r, "_routes.json"))).toEqual({
      version: 1,
      include: ["/*"],
      exclude: ["/.well-known/*", "/deeplinker.js"],
    });
  });

  it("cloudflare merges into an existing _routes.json without dropping anything", () => {
    const existing = JSON.stringify({ version: 1, include: ["/api/*"], exclude: ["/static/*"] });
    const out = file(run("cloudflare", { existing: { routesJson: existing } }), "_routes.json");
    expect(JSON.parse(out?.content ?? "")).toEqual({
      version: 1,
      include: ["/api/*"],
      exclude: ["/static/*", "/.well-known/*", "/deeplinker.js"],
    });
    const again = file(run("cloudflare", { existing: { routesJson: out?.content } }), "_routes.json");
    expect(again?.content).toBe(out?.content);
  });
});

describe("laravel and wordpress", () => {
  it("laravel serves the JSON from routes, with the right Content-Type, outside the web middleware group", () => {
    const r = run("laravel");
    const php = text(r, "laravel/routes/deeplinker.php");
    expect(php).toContain("Route::get('/.well-known/apple-app-site-association'");
    expect(php).toContain("'Content-Type' => 'application/json'");
    expect(php).toContain(text(r, ".well-known/apple-app-site-association").trim());
    expect(php).toContain("bootstrap/app.php");
  });

  it("wordpress ships a must-use plugin that serves the files and prints the script tag in the head", () => {
    const r = run("wordpress");
    const php = text(r, "wordpress/deeplinker.php");
    expect(php).toContain("add_action('init'");
    expect(php).toContain("'/.well-known/assetlinks.json'");
    expect(php).toContain("Content-Type: application/json");
    expect(php).toContain('<script src="/deeplinker.js" async></script>');
    expect(php).not.toContain("apple-itunes-app");
    expect(php).toContain(text(r, ".well-known/assetlinks.json").trim());
  });
});

describe("static", () => {
  it("emits no host file", () => {
    const r = run("static");
    expect(r.files.map((f) => f.path)).toEqual([
      ".well-known/apple-app-site-association",
      ".well-known/assetlinks.json",
      ".well-known/windows-app-web-link",
      "manifest.fragment.json",
      "deeplinker.js",
      "snippet.html",
      "README-DEPLOY.md",
      "app-snippets.md",
    ]);
  });
});

describe("every host", () => {
  it.each(["apache", "nginx", "vercel", "netlify", "cloudflare", "laravel", "wordpress"])(
    "%s adds no redirect and no authentication",
    (hosting) => {
      const r = run(hosting);
      const hostFiles = r.files.filter(
        (f) =>
          !f.path.startsWith(".well-known/") &&
          ![
            "deeplinker.js",
            "snippet.html",
            "README-DEPLOY.md",
            "app-snippets.md",
            "manifest.fragment.json",
          ].includes(f.path),
      );
      expect(hostFiles.length).toBeGreaterThan(0);
      for (const f of hostFiles) {
        expect(f.content, f.path).not.toMatch(
          /return\s+30\d|Redirect(?:Match|Permanent)?\s|\[R[=,\]]|auth_basic|AuthType|"redirects"|wp_redirect|redirect\(/i,
        );
      }
    },
  );

  it("emits no host file when the config produces no association files", () => {
    const r = generate(resolved({ hosting: "apache" }), { runtimeTemplate: TEMPLATE });
    expect(r.files.map((f) => f.path)).toEqual(["deeplinker.js", "snippet.html", "README-DEPLOY.md"]);
  });
});
