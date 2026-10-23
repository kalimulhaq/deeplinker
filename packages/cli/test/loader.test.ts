import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config-loader";
import { CliError } from "../src/errors";
import { KIT_ALIAS, project } from "./helpers";

const opts = { alias: KIT_ALIAS };

describe("loadConfig", () => {
  it("loads deeplinker.config.ts that imports defineConfig from the package", async () => {
    const dir = project({
      "deeplinker.config.ts": `import { defineConfig } from "@kalimulhaq/deeplinker";\nexport default defineConfig({ domains: ["example.com"] });\n`,
    });
    const loaded = await loadConfig(dir, undefined, opts);
    expect(loaded.raw).toEqual({ domains: ["example.com"] });
    expect(loaded.file).toBe(`${dir}/deeplinker.config.ts`);
  });

  it("loads .mjs and .js, and .json", async () => {
    expect(
      (
        await loadConfig(
          project({ "deeplinker.config.mjs": `export default { domains: ["a.example.com"] };` }),
          undefined,
          opts,
        )
      ).raw,
    ).toEqual({ domains: ["a.example.com"] });
    expect(
      (
        await loadConfig(
          project({ "deeplinker.config.json": `{ "domains": ["b.example.com"] }` }),
          undefined,
          opts,
        )
      ).raw,
    ).toEqual({ domains: ["b.example.com"] });
  });

  it("prefers deeplinker.config.ts over the other formats", async () => {
    const dir = project({
      "deeplinker.config.json": `{ "domains": ["json.example.com"] }`,
      "deeplinker.config.ts": `export default { domains: ["ts.example.com"] };`,
    });
    expect((await loadConfig(dir, undefined, opts)).raw).toEqual({ domains: ["ts.example.com"] });
  });

  it("loads an explicit --config path", async () => {
    const dir = project({ "config/site.json": `{ "domains": ["site.example.com"] }` });
    expect((await loadConfig(dir, "config/site.json", opts)).raw).toEqual({ domains: ["site.example.com"] });
  });

  it("says how to create a config when there is none", async () => {
    const error = await loadConfig(project(), undefined, opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("npx deeplinker init");
    expect((error as CliError).exitCode).toBe(2);
  });

  it("says when an explicit file does not exist", async () => {
    const error = await loadConfig(project(), "nope.ts", opts).catch((e: unknown) => e);
    expect((error as CliError).message).toContain("nope.ts");
  });

  it("reports invalid JSON readably", async () => {
    const error = await loadConfig(project({ "deeplinker.config.json": "{ nope" }), undefined, opts).catch(
      (e: unknown) => e,
    );
    expect((error as CliError).message).toContain("deeplinker.config.json");
    expect((error as CliError).message).toMatch(/JSON/i);
  });

  it("reports a config that throws while loading, with the file name", async () => {
    const error = await loadConfig(
      project({ "deeplinker.config.ts": `throw new Error("boom");` }),
      undefined,
      opts,
    ).catch((e: unknown) => e);
    expect((error as CliError).message).toContain("deeplinker.config.ts");
    expect((error as CliError).message).toContain("boom");
  });

  it("reports a config file with no default export", async () => {
    const error = await loadConfig(
      project({ "deeplinker.config.ts": `export const domains = ["x.example.com"];` }),
      undefined,
      opts,
    ).catch((e: unknown) => e);
    expect((error as CliError).message).toContain("default");
  });

  it("does not write a cache into the project", async () => {
    const dir = project({ "deeplinker.config.ts": `export default { domains: ["example.com"] };` });
    await loadConfig(dir, undefined, opts);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).sort()).toEqual(["deeplinker.config.ts"]);
  });
});
