// The promise of the page: the ZIP holds the same files `deeplinker build` writes. Checked against the real command.
import { build } from "@deeplinker/cli";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBundle, ZIP_FOLDER, zipBundle } from "../src/bundle";
import { EXAMPLE } from "../src/example";
import { toJsonText } from "../src/form";
import { asText, readZip } from "./zip-reader";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function walk(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, base, out);
    else out[relative(base, path).split("\\").join("/")] = readFileSync(path, "utf8");
  }
  return out;
}

/** What the command line writes for this config, in a project that holds `projectFiles`. */
async function viaCommandLine(json: string, projectFiles: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deeplinker-parity-"));
  made.push(dir);
  writeFileSync(join(dir, "deeplinker.config.json"), json);
  for (const [name, content] of Object.entries(projectFiles)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  await build({ cwd: dir, log: () => {}, color: false });
  return walk(join(dir, "deeplinker-dist"));
}

const HOSTS = [
  "static",
  "apache",
  "nginx",
  "vercel",
  "netlify",
  "cloudflare",
  "laravel",
  "wordpress",
] as const;

describe("the ZIP is what `deeplinker build` writes", () => {
  it.each(HOSTS)("%s: every file, byte for byte", async (hosting) => {
    const json = toJsonText({ ...EXAMPLE, hosting });
    const cli = await viaCommandLine(json);
    const bundle = buildBundle(json);
    if (!bundle.ok) throw new Error(bundle.ok ? "" : JSON.stringify(bundle));
    const zipped = Object.fromEntries(
      readZip(zipBundle(bundle)).map((e) => [e.name.slice(ZIP_FOLDER.length + 1), asText(e)]),
    );
    expect(Object.keys(zipped).sort()).toEqual(Object.keys(cli).sort());
    for (const [path, content] of Object.entries(cli)) expect(zipped[path], path).toBe(content);
  });

  it.each(["apache", "nginx", "vercel", "netlify", "cloudflare", "laravel", "wordpress"] as const)(
    "%s with deferred deep linking on",
    async (hosting) => {
      const json = toJsonText({ ...EXAMPLE, hosting, deferred: { enabled: true } });
      const cli = await viaCommandLine(json);
      const bundle = buildBundle(json);
      if (!bundle.ok) throw new Error(JSON.stringify(bundle));
      expect(Object.keys(cli).some((p) => p.startsWith("deferred/"))).toBe(true);
      const zipped = Object.fromEntries(bundle.files.map((f) => [f.path, f.content]));
      expect(zipped).toEqual(cli);
    },
  );

  it("with files merged: the pasted ones give what `build` makes from the same files in a project", async () => {
    const mine = {
      ".htaccess": "RewriteEngine On\nRewriteRule ^old$ /new [R=301,L]\n",
      "manifest.json": JSON.stringify({ name: "My app", start_url: "/" }, null, 2),
    };
    const json = toJsonText({ ...EXAMPLE, hosting: "apache", web: { url: "https://app.example.com" } });
    const cli = await viaCommandLine(json, mine);
    const bundle = buildBundle(json, { htaccess: mine[".htaccess"], manifest: mine["manifest.json"] });
    if (!bundle.ok) throw new Error(JSON.stringify(bundle));
    expect(Object.fromEntries(bundle.files.map((f) => [f.path, f.content]))).toEqual(cli);
  });
});
