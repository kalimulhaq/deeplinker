import { BIN_NAME, PACKAGE_NAME } from "@deeplinker/core";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const built = existsSync(resolve(root, "dist/cli.js"));
const needsBuild = built ? it : it.skip;

describe("package.json", () => {
  it("name and bin come from the one constants file", () => {
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(Object.keys(pkg.bin)).toEqual([BIN_NAME]);
  });

  it("is publishable: public, MIT, versioned, pointing at the public repository", () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.license).toBe("MIT");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.repository.url).toBe("git+https://github.com/kalimulhaq/deeplinker.git");
    expect(pkg.homepage).toContain("github.com/kalimulhaq/deeplinker");
    expect(pkg.engines.node).toBe(">=18");
  });

  it("depends only on third-party packages: the workspaces are bundled in", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@clack/prompts",
      "commander",
      "diff",
      "jiti",
      "zod",
    ]);
    expect(Object.keys(pkg.dependencies).some((d) => d.startsWith("@deeplinker/"))).toBe(false);
  });

  it("ships only dist, bin, README and LICENSE", () => {
    expect(pkg.files).toEqual(["dist", "bin", "README.md", "LICENSE"]);
  });
});

describe("the built package", () => {
  needsBuild("has the files the exports map promises", () => {
    for (const rel of [
      "dist/index.js",
      "dist/index.cjs",
      "dist/index.d.ts",
      "dist/cli.js",
      "dist/deferred.js",
      "dist/deferred.d.ts",
      "dist/openapi.yaml",
      "dist/runtime/index.d.ts",
      "dist/runtime/deeplinker.esm.js",
      "dist/runtime/deeplinker.umd.js",
      "bin/deeplinker.js",
    ]) {
      expect(existsSync(resolve(root, rel)), rel).toBe(true);
    }
  });

  needsBuild("does not import the internal workspaces at run time: they are bundled", () => {
    for (const file of ["dist/index.js", "dist/index.cjs", "dist/cli.js", "dist/deferred.js"]) {
      expect(readFileSync(resolve(root, file), "utf8"), file).not.toMatch(
        /from ["']@deeplinker\/|require\(["']@deeplinker\//,
      );
    }
  });

  needsBuild("loads as ESM and as CommonJS, with defineConfig and generate", async () => {
    const esm = await import(pathToFileURL(resolve(root, "dist/index.js")).href);
    const cjs = createRequire(import.meta.url)(resolve(root, "dist/index.cjs"));
    for (const api of [esm, cjs]) {
      expect(typeof api.defineConfig).toBe("function");
      expect(typeof api.generate).toBe("function");
      expect(api.PACKAGE_NAME).toBe(PACKAGE_NAME);
    }
    const config = esm.defineConfig({ domains: ["example.com"] });
    expect(esm.parseConfig(config).ok).toBe(true);
  });

  needsBuild("@kalimulhaq/deeplinker/deferred loads and answers a click and a match", async () => {
    const api = await import(pathToFileURL(resolve(root, "dist/deferred.js")).href);
    expect(Object.keys(api)).toEqual(
      expect.arrayContaining([
        "createHandler",
        "memoryStore",
        "kvStore",
        "redisStore",
        "sqliteStore",
        "postgresStore",
        "toNodeListener",
        "renderDeferred",
      ]),
    );
    const handle = api.createHandler({
      settings: { hosts: ["example.com"], ttlSeconds: 60, clipboard: false },
      store: api.memoryStore(),
      ip: () => "203.0.113.5",
    });
    const post = (path: string, body: object) =>
      handle(
        new Request(`https://example.com${path}`, {
          method: "POST",
          headers: {
            "user-agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
          },
          body: JSON.stringify(body),
        }),
      );
    expect((await post("/dl/click", { url: "https://example.com/p/1?x=1" })).status).toBe(204);
    expect(await (await post("/dl/match", { platform: "ios", osVersion: "17.5" })).json()).toMatchObject({
      match: "probabilistic",
      url: "https://example.com/p/1?x=1",
    });
  });

  needsBuild("the bin prints its version and lists the four commands", () => {
    const run = (...args: string[]) =>
      execFileSync(process.execPath, [resolve(root, "bin/deeplinker.js"), ...args], { encoding: "utf8" });
    expect(run("--version").trim()).toBe(pkg.version);
    const help = run("--help");
    for (const name of ["init", "build", "verify", "app-snippets"]) expect(help).toContain(name);
  });

  needsBuild("npm pack would publish dist, bin, README and LICENSE, and no sources or tests", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
    });
    const files = (JSON.parse(out)[0].files as { path: string }[]).map((f) => f.path);
    expect(files).toContain("bin/deeplinker.js");
    expect(files).toContain("dist/cli.js");
    expect(files).toContain("dist/runtime/deeplinker.umd.js");
    expect(files).toContain("package.json");
    expect(
      files.some(
        (f) => f.startsWith("src/") || f.startsWith("test/") || (f.endsWith(".ts") && !f.endsWith(".d.ts")),
      ),
    ).toBe(false);
  });
});
