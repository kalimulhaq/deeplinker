import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { run } from "../src/main";
import { KIT_ALIAS, configJson, project } from "./helpers";

async function cli(dir: string, args: string[], extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    cwd: dir,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    alias: KIT_ALIAS,
    ...extra,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("the command line", () => {
  it("build writes the output and exits 0", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const { code, out } = await cli(dir, ["build"]);
    expect(code).toBe(0);
    expect(existsSync(join(dir, "deeplinker-dist/.well-known/apple-app-site-association"))).toBe(true);
    expect(out).toContain("npx deeplinker verify https://example.com");
  });

  it("build --hosting rejects a host it does not know and exits 1", async () => {
    const { code, err } = await cli(project({ "deeplinker.config.json": configJson() }), [
      "build",
      "--hosting",
      "iis",
    ]);
    expect(code).toBe(1);
    expect(err).toContain("iis");
  });

  it("an invalid config exits 2 with the path, the problem and an example", async () => {
    const dir = project({ "deeplinker.config.json": JSON.stringify({ domains: ["https://Example.com/"] }) });
    const { code, err } = await cli(dir, ["build"]);
    expect(code).toBe(2);
    expect(err).toContain("domains[0]");
    expect(err).toContain('e.g. domains: ["www.example.com", "m.example.com"]');
  });

  it("a missing config exits 2 and says to run init", async () => {
    const { code, err } = await cli(project(), ["build"]);
    expect(code).toBe(2);
    expect(err).toContain("npx deeplinker init");
  });

  it("init --yes writes a config, and a second run exits 1 instead of overwriting", async () => {
    const dir = project();
    expect((await cli(dir, ["init", "--yes", "--domains", "example.com"])).code).toBe(0);
    expect(readFileSync(join(dir, "deeplinker.config.ts"), "utf8")).toContain('"example.com"');
    const again = await cli(dir, ["init", "--yes", "--domains", "example.com"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("already exists");
  });

  it("app-snippets prints the setup for each app, and --platform narrows it", async () => {
    const dir = project({ "deeplinker.config.json": configJson() });
    const all = await cli(dir, ["app-snippets"]);
    expect(all.code).toBe(0);
    expect(all.out).toContain("applinks:example.com");
    expect(all.out).toContain('<intent-filter android:autoVerify="true">');
    expect(all.out).toContain("uap3:AppUriHandler");
    const only = await cli(dir, ["app-snippets", "--platform", "android"]);
    expect(only.out).toContain("autoVerify");
    expect(only.out).not.toContain("applinks:");
  });

  it("verify exits 1 when a check fails and prints a table with the fix", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("no");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const dir = project({ "deeplinker.config.json": configJson() });
      const { code, out } = await cli(dir, ["verify", url, "--allow-http", "--timeout", "2000"]);
      expect(code).toBe(1);
      expect(out).toContain("✗ FAIL");
      expect(out).toContain("fix:");
      expect(out).toMatch(/\d+ passed, \d+ failed, \d+ skipped/);

      const json = await cli(dir, ["verify", url, "--allow-http", "--json", "--timeout", "2000"]);
      expect(JSON.parse(json.out).ok).toBe(false);
    } finally {
      server.close();
    }
  });

  it("verify refuses http:// without --allow-http, and exits 2", async () => {
    const { code, err } = await cli(project({ "deeplinker.config.json": configJson() }), [
      "verify",
      "http://example.com",
    ]);
    expect(code).toBe(2);
    expect(err).toContain("--allow-http");
  });

  it("--version prints the version and --help lists the four commands", async () => {
    const dir = project();
    expect((await cli(dir, ["--version"], { version: "1.2.3" })).out).toBe("1.2.3");
    const help = await cli(dir, ["--help"]);
    for (const name of ["init", "build", "verify", "app-snippets"]) expect(help.out).toContain(name);
  });

  it("an unknown command exits 1", async () => {
    expect((await cli(project(), ["frobnicate"])).code).toBe(1);
  });
});

describe("verify --timeout", () => {
  it.each(["abc", "0", "-5", "Infinity"])(
    "rejects %s with an example and exits 1, without checking anything",
    async (value) => {
      const dir = project({ "deeplinker.config.json": configJson() });
      const { code, err, out } = await cli(dir, [
        "verify",
        "http://127.0.0.1:1",
        "--allow-http",
        "--timeout",
        value,
      ]);
      expect(code).toBe(1);
      expect(err).toContain("milliseconds");
      expect(out).toBe("");
    },
  );
});
