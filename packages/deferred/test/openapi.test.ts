import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createHandler } from "../src/handler";
import { memoryStore } from "../src/stores/memory";

const spec = parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../openapi.yaml"), "utf8"));
const schemas = spec.components.schemas;

describe("openapi.yaml", () => {
  it("is OpenAPI 3 with exactly the two operations", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths).sort()).toEqual(["/dl/click", "/dl/match"]);
    expect(spec.paths["/dl/click"].post.operationId).toBe("recordClick");
    expect(spec.paths["/dl/match"].post.operationId).toBe("matchInstall");
  });

  it("every $ref points at something that exists", () => {
    const refs = JSON.stringify(spec).match(/#\/components\/[A-Za-z]+\/[A-Za-z]+/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const [, , group, name] = ref.split("/");
      expect(spec.components[group as string]?.[name as string], ref).toBeDefined();
    }
  });

  it("describes the request fields the handler reads, and no others", () => {
    expect(Object.keys(schemas.MatchRequest.properties).sort()).toEqual([
      "clipboard",
      "deviceClass",
      "installReferrer",
      "language",
      "osVersion",
      "platform",
    ]);
    expect(Object.keys(schemas.ClickRequest.properties)).toEqual(["url"]);
  });

  it("lists exactly the match kinds the handler can return", async () => {
    expect(schemas.MatchResponse.properties.match.enum.sort()).toEqual([
      "clipboard",
      "deterministic",
      "none",
      "probabilistic",
    ]);
    const handle = createHandler({
      settings: { hosts: ["example.com"], ttlSeconds: 60, clipboard: true },
      store: memoryStore(),
      ip: () => "203.0.113.1",
    });
    const ask = async (body: object) =>
      (
        (await (
          await handle(
            new Request("https://example.com/dl/match", { method: "POST", body: JSON.stringify(body) }),
          )
        ).json()) as { match: string }
      ).match;
    const seen = new Set([
      await ask({}),
      await ask({ installReferrer: "https://example.com/a" }),
      await ask({ clipboard: "https://example.com/a" }),
    ]);
    for (const kind of seen) expect(schemas.MatchResponse.properties.match.enum).toContain(kind);
  });

  it("lists exactly the error codes the handler uses", async () => {
    const handle = createHandler({
      settings: { hosts: ["example.com"], ttlSeconds: 60, clipboard: false },
      store: memoryStore(),
      ip: () => "203.0.113.1",
    });
    const post = (path: string, body: string) =>
      handle(new Request(`https://example.com${path}`, { method: "POST", body }));
    const codes = new Set<string>();
    for (const res of [
      await post("/dl/click", "{ nope"),
      await post("/dl/click", JSON.stringify({ url: "https://evil.example.org/" })),
      await post("/dl/click", "x".repeat(5000)),
      await post("/dl/other", "{}"),
      await handle(new Request("https://example.com/dl/click")),
    ]) {
      codes.add(((await res.json()) as { error: string }).error);
    }
    for (const code of codes) expect(schemas.ErrorResponse.properties.error.enum, code).toContain(code);
    expect(schemas.ErrorResponse.properties.error.enum.sort()).toEqual([
      "invalid_json",
      "invalid_url",
      "method_not_allowed",
      "not_found",
      "server_error",
      "too_large",
    ]);
  });

  it("documents every status the handler returns", () => {
    expect(Object.keys(spec.paths["/dl/click"].post.responses).sort()).toEqual([
      "204",
      "400",
      "405",
      "413",
      "500",
    ]);
    expect(Object.keys(spec.paths["/dl/match"].post.responses).sort()).toEqual([
      "200",
      "400",
      "405",
      "413",
      "500",
    ]);
  });
});
