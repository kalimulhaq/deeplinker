import { generate } from "@deeplinker/generator";
import { parseConfig } from "@deeplinker/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { build, type BuildOptions } from "../src/commands/build";
import { CliError } from "../src/errors";
import { FULL_CONFIG, KIT_ALIAS, configJson, project } from "./helpers";

function run(dir: string, over: Partial<BuildOptions> = {}) {
  const lines: string[] = [];
  const promise = build({
    cwd: dir,
    alias: KIT_ALIAS,
    log: (line) => lines.push(line),
    color: false,
    ...over,
  });
  return promise.then((result) => ({ result, out: lines.join("\n") }));
}

/** Every file under `dir` with its contents, so a test can prove nothing outside outDir changed. */
function tree(dir: string, skip = "deeplinker-dist"): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      const rel = relative(dir, path);
      if (rel === skip) continue;
      if (statSync(path).isDirectory()) walk(path);
      else out[rel] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return out;
}

const config = () => {
  const parsed = parseConfig({
    domains: ["example.com", "www.example.com"],
    paths: ["/property/*", "!/admin/*"],
    apps: {
      ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
      android: {
        packageName: "com.example.app",
        sha256CertFingerprints: [
          "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5",
        ],
        stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
      },
      windows: {
        packageFamilyName: "Example_abc123xyz",
        storeUrl: "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1",
      },
    },
    web: {
      url: "https://app.example.com",
      routes: [{ from: "/property/:id", to: "/p/:id" }],
      pwa: { handleLinks: "preferred" },
    },
    hosting: "apache",
  });
  if (!parsed.ok) throw new Error("bad test config");
  return parsed.config;
};

describe("build", () => {
  it("writes every generated file under outDir", async () => {
    const dir = project({ "deeplinker.config.ts": FULL_CONFIG });
    const { result } = await run(dir);
    const expected = generate(config())
      .files.map((f) => f.path)
      .sort();
    expect(result.written.slice().sort()).toEqual(expected);
    for (const path of expected) expect(existsSync(join(dir, "deeplinker-dist", path)), path).toBe(true);
  });

  it("writes the same bytes the generator produced", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    await run(dir);
    const aasa = generate(config()).files.find(
      (f) => f.path === ".well-known/apple-app-site-association",
    )?.content;
    expect(readFileSync(join(dir, "deeplinker-dist/.well-known/apple-app-site-association"), "utf8")).toBe(
      aasa,
    );
  });

  it("never modifies the user's own files, and merges into copies under outDir", async () => {
    const files = {
      "deeplinker.config.json": configJson({ hosting: "auto" }),
      ".htaccess": "RewriteEngine On\nRewriteRule ^old$ /new [R=301,L]\n",
      "public/manifest.json": JSON.stringify(
        { name: "Example", start_url: "/", handle_links: "not-preferred" },
        null,
        2,
      ),
    };
    const dir = project(files);
    const before = tree(dir);
    const { result } = await run(dir);
    expect(tree(dir)).toEqual(before);
    expect(readFileSync(join(dir, "deeplinker-dist/.htaccess"), "utf8")).toContain(
      "RewriteRule ^old$ /new [R=301,L]",
    );
    expect(readFileSync(join(dir, "deeplinker-dist/.htaccess"), "utf8")).toContain("# BEGIN deeplinker");
    expect(JSON.parse(readFileSync(join(dir, "deeplinker-dist/manifest.json"), "utf8")).name).toBe("Example");
    expect(result.written).toContain("manifest.json");
  });

  it("prints a diff for each file it merged, naming your original", async () => {
    const dir = project({
      "deeplinker.config.json": configJson({ hosting: "auto" }),
      "public/.htaccess": "RewriteEngine On\n",
    });
    const { out, result } = await run(dir);
    expect(result.diffs.map((d) => d.path)).toEqual([".htaccess"]);
    expect(out).toContain("public/.htaccess");
    expect(out).toMatch(/^\+# BEGIN deeplinker$/m);
    expect(out).toMatch(/^ RewriteEngine On$/m);
  });

  it("a fresh project has nothing to merge and prints no diff", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const { result, out } = await run(dir);
    expect(result.diffs).toEqual([]);
    expect(out).not.toContain("Merged into");
  });

  it("is idempotent: a second run gives the same output", async () => {
    const dir = project({ "deeplinker.config.json": configJson(), ".htaccess": "RewriteEngine On\n" });
    await run(dir);
    const first = tree(join(dir, "deeplinker-dist"), "");
    await run(dir);
    expect(tree(join(dir, "deeplinker-dist"), "")).toEqual(first);
  });

  it("--dry-run writes nothing", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const { result, out } = await run(dir, { dryRun: true });
    expect(existsSync(join(dir, "deeplinker-dist"))).toBe(false);
    expect(result.written.length).toBeGreaterThan(0);
    expect(out).toMatch(/dry run/i);
  });

  it("says which host it picked and why", async () => {
    const dir = project({
      "deeplinker.config.json": configJson({ hosting: "auto" }),
      "vercel.json": "{}",
    });
    const { out, result } = await run(dir);
    expect(result.host).toMatchObject({ id: "vercel", detected: true, evidence: ["vercel.json"] });
    expect(out).toContain("Vercel");
    expect(out).toContain("vercel.json");
  });

  it("says when nothing was recognised and suggests setting hosting", async () => {
    const dir = project({
      "deeplinker.config.json": configJson({ hosting: "auto" }),
    });
    const { out } = await run(dir);
    expect(out).toContain("hosting");
    expect(out).toMatch(/static/i);
  });

  it("--hosting beats the config", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const { result } = await run(dir, { hosting: "nginx" });
    expect(result.written).toContain("nginx-deeplinker.conf");
    expect(result.written).not.toContain(".htaccess");
  });

  it("--out beats the config's outDir", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    await run(dir, { out: "dist-links" });
    expect(existsSync(join(dir, "dist-links/deeplinker.js"))).toBe(true);
    expect(existsSync(join(dir, "deeplinker-dist"))).toBe(false);
  });

  it("refuses an outDir that is the project itself or contains it", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    await expect(run(dir, { out: "." })).rejects.toThrow(CliError);
    await expect(run(dir, { out: ".." })).rejects.toThrow(/outDir/);
  });

  it("reports an invalid config with the path, the problem and an example, and exits 2", async () => {
    const dir = project({ "deeplinker.config.json": JSON.stringify({ domains: ["https://Example.com/"] }) });
    const error = await run(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(2);
    expect((error as CliError).message).toContain("domain");
    expect((error as CliError).message).toContain("is a URL");
    expect((error as CliError).message).toContain('e.g. domains: ["www.example.com", "m.example.com"]');
  });

  it("prints the config's warnings", async () => {
    const dir = project({
      "deeplinker.config.json": JSON.stringify({
        domains: ["example.com"],
        apps: { android: { packageName: "com.example.app" } },
      }),
    });
    const { out } = await run(dir);
    expect(out).toContain("sha256CertFingerprints");
  });

  it("prints the size of deeplinker.js and the next steps, ending with the verify command", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const { out } = await run(dir);
    expect(out).toMatch(/deeplinker\.js\s+\d+(\.\d+)? KB/);
    expect(out).toContain("README-DEPLOY.md");
    expect(out).toContain("npx deeplinker app-snippets");
    expect(out.trimEnd().endsWith("npx deeplinker verify https://example.com")).toBe(true);
  });
});

describe("build: an output folder that holds your own files", () => {
  const withOut = (out: string) => configJson({ outDir: out, hosting: "netlify" });

  it("refuses to replace a file of yours, and leaves it as it was", async () => {
    const dir = project({
      "deeplinker.config.json": withOut("public"),
      "public/_headers": "/*\n  X-Frame-Options: DENY\n",
    });
    await expect(run(dir)).rejects.toThrow(/public\/ already contains .*_headers.*not made by a previous/s);
    expect(readFileSync(join(dir, "public/_headers"), "utf8")).toBe("/*\n  X-Frame-Options: DENY\n");
    expect(existsSync(join(dir, "public/.well-known/apple-app-site-association"))).toBe(false);
  });

  it("still works in a new folder, and again on a second run", async () => {
    const dir = project({ "deeplinker.config.json": withOut("public"), "index.html": "<html></html>" });
    await run(dir);
    expect(existsSync(join(dir, "public/README-DEPLOY.md"))).toBe(true);
    const first = readFileSync(join(dir, "public/_headers"), "utf8");
    await run(dir);
    expect(readFileSync(join(dir, "public/_headers"), "utf8")).toBe(first);
  });

  it("a dry run reports the same problem", async () => {
    const dir = project({ "deeplinker.config.json": withOut("public"), "public/_headers": "x" });
    await expect(run(dir, { dryRun: true })).rejects.toBeInstanceOf(CliError);
  });
});

describe("build: paths that try to leave the project", () => {
  it("refuses an outDir that is a symlink to somewhere else", async () => {
    const elsewhere = project();
    const dir = project({ "deeplinker.config.json": configJson({ outDir: "link" }) });
    symlinkSync(elsewhere, join(dir, "link"));
    await expect(run(dir)).rejects.toThrow(/symbolic link counts/);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses an outDir that is a symlink to the project itself", async () => {
    const dir = project({ "deeplinker.config.json": configJson({ outDir: "link" }) });
    symlinkSync(dir, join(dir, "link"));
    await expect(run(dir)).rejects.toThrow(/symbolic link counts/);
  });

  it("does not write through a symlinked file inside outDir", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const victim = join(project({ "victim.txt": "keep" }), "victim.txt");
    mkdirSync(join(dir, "deeplinker-dist"));
    symlinkSync(victim, join(dir, "deeplinker-dist/README-DEPLOY.md"));
    await expect(run(dir)).rejects.toThrow(/symbolic link/);
    expect(readFileSync(victim, "utf8")).toBe("keep");
  });

  it("refuses a manifestPath that climbs out of the folder", async () => {
    const dir = project({
      "deeplinker.config.json": configJson({
        web: { url: "https://app.example.com", pwa: { manifestPath: "/../../x/manifest.json" } },
      }),
    });
    await expect(run(dir)).rejects.toThrow(/manifestPath/);
    expect(existsSync(join(dirname(dir), "x"))).toBe(false);
  });
});
