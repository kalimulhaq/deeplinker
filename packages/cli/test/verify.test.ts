import { generate } from "@deeplinker/generator";
import { parseConfig, HANDLE_ALL_URLS, type ResolvedConfig } from "@deeplinker/core";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { verify, type VerifyOptions } from "../src/commands/verify";
import { FP } from "./helpers";

const AASA = ".well-known/apple-app-site-association";
const ASSETLINKS = ".well-known/assetlinks.json";
const WINDOWS = ".well-known/windows-app-web-link";

function makeConfig(over: Record<string, unknown> = {}): ResolvedConfig {
  const parsed = parseConfig({
    domains: ["example.com"],
    paths: ["/property/*", "/about", "!/admin/*"],
    apps: {
      ios: { appIds: ["ABCDE12345.com.example.app"], storeUrl: "https://apps.apple.com/app/id123456789" },
      android: {
        packageName: "com.example.app",
        sha256CertFingerprints: [FP],
        stores: { google: "https://play.google.com/store/apps/details?id=com.example.app" },
      },
      windows: { packageFamilyName: "Example_abc123xyz" },
    },
    ...over,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

const config = makeConfig();
const local = new Map(generate(config).files.map((f) => [f.path, f.content]));
const localHash = generate(config).hash;

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** Starts a server on a random port. `routes` maps a URL path to a handler; unknown paths 404. */
async function serve(routes: Record<string, Handler>): Promise<string> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const handler = routes[path];
    if (handler) handler(req, res);
    else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const send =
  (body: string, type = "application/json", status = 200): Handler =>
  (_req, res) => {
    res.statusCode = status;
    res.setHeader("Content-Type", type);
    res.end(body);
  };

/** The routes of a healthy deployment. */
function good(): Record<string, Handler> {
  const routes: Record<string, Handler> = {};
  for (const path of [AASA, ASSETLINKS, WINDOWS]) routes["/" + path] = send(local.get(path) as string);
  routes["/deeplinker.js"] = send(local.get("deeplinker.js") as string, "application/javascript");
  routes["/property/42"] = send("<html>", "text/html");
  routes["/about"] = send("<html>", "text/html");
  return routes;
}

function check(report: Awaited<ReturnType<typeof verify>>, id: string) {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}; have ${report.checks.map((x) => x.id).join(", ")}`);
  return c;
}

const run = (url: string, over: Partial<VerifyOptions> = {}) =>
  verify({ url, config, allowHttp: true, ...over });

describe("verify: a healthy deployment", () => {
  it("passes every check that can run on a local server", async () => {
    const report = await run(await serve(good()), { sample: ["/property/42"] });
    expect(report.ok).toBe(true);
    for (const id of [
      `file:${AASA}`,
      `file:${ASSETLINKS}`,
      `file:${WINDOWS}`,
      "deeplinker.js",
      "path:/about",
      "path:/property/42",
    ]) {
      expect(check(report, id).status, id).toBe("pass");
    }
  });

  it("skips Apple's CDN and Google's API for a local server, and says why", async () => {
    const report = await run(await serve(good()));
    expect(check(report, "apple-cdn").status).toBe("skip");
    expect(check(report, "apple-cdn").message).toMatch(/public|local/i);
    expect(check(report, "google-dal:com.example.app").status).toBe("skip");
  });

  it("accepts a bare host name and assumes https", async () => {
    const report = await verify({ url: "127.0.0.1:1", config, timeoutMs: 300 });
    expect(report.checks.length).toBeGreaterThan(0);
  });
});

describe("verify: each failure, with a fix", () => {
  it("a redirecting association file fails and names where it redirects", async () => {
    const routes = good();
    routes["/" + AASA] = (_req, res) => {
      res.statusCode = 301;
      res.setHeader("Location", "https://www.example.com/.well-known/apple-app-site-association");
      res.end();
    };
    const report = await run(await serve(routes));
    const c = check(report, `file:${AASA}`);
    expect(c.status).toBe("fail");
    expect(c.message).toContain("301");
    expect(c.message).toContain("www.example.com");
    expect(c.fix).toMatch(/redirect/i);
    expect(report.ok).toBe(false);
  });

  it("a wrong content type fails", async () => {
    const routes = good();
    routes["/" + AASA] = send(local.get(AASA) as string, "application/octet-stream");
    const c = check(await run(await serve(routes)), `file:${AASA}`);
    expect(c.status).toBe("fail");
    expect(c.message).toContain("application/octet-stream");
    expect(c.fix).toContain("application/json");
  });

  it("a content type with a charset is fine", async () => {
    const routes = good();
    routes["/" + AASA] = send(local.get(AASA) as string, "application/json; charset=utf-8");
    expect(check(await run(await serve(routes)), `file:${AASA}`).status).toBe("pass");
  });

  it("invalid JSON fails", async () => {
    const routes = good();
    routes["/" + ASSETLINKS] = send("{ not json");
    const c = check(await run(await serve(routes)), `file:${ASSETLINKS}`);
    expect(c.status).toBe("fail");
    expect(c.message).toMatch(/JSON/);
  });

  it("content that differs from the local config fails and says what to do", async () => {
    const routes = good();
    routes["/" + AASA] = send(JSON.stringify({ applinks: { details: [] } }));
    const c = check(await run(await serve(routes)), `file:${AASA}`);
    expect(c.status).toBe("fail");
    expect(c.message).toMatch(/differs|match/i);
    expect(c.fix).toMatch(/build|deploy/i);
  });

  it("formatting differences alone are not a mismatch", async () => {
    const routes = good();
    routes["/" + AASA] = send(JSON.stringify(JSON.parse(local.get(AASA) as string)));
    expect(check(await run(await serve(routes)), `file:${AASA}`).status).toBe("pass");
  });

  it("a 404 fails", async () => {
    const routes = good();
    delete routes["/" + ASSETLINKS];
    const c = check(await run(await serve(routes)), `file:${ASSETLINKS}`);
    expect(c.status).toBe("fail");
    expect(c.message).toContain("404");
  });

  it("a server that is down fails every file check without throwing", async () => {
    const report = await verify({ url: "http://127.0.0.1:1", config, allowHttp: true, timeoutMs: 500 });
    expect(check(report, `file:${AASA}`).status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("a deeplinker.js built from a different config fails with both hashes", async () => {
    const routes = good();
    routes["/deeplinker.js"] = send(
      "/*! @kalimulhaq/deeplinker config:0123456789abcd */\nvar x=1;",
      "application/javascript",
    );
    const c = check(await run(await serve(routes)), "deeplinker.js");
    expect(c.status).toBe("fail");
    expect(c.message).toContain("0123456789abcd");
    expect(c.message).toContain(localHash);
    expect(c.fix).toMatch(/build/i);
  });

  it("a deeplinker.js with no banner fails", async () => {
    const routes = good();
    routes["/deeplinker.js"] = send("var x=1;", "application/javascript");
    expect(check(await run(await serve(routes)), "deeplinker.js").status).toBe("fail");
  });

  it("a missing deeplinker.js fails", async () => {
    const routes = good();
    delete routes["/deeplinker.js"];
    expect(check(await run(await serve(routes)), "deeplinker.js").status).toBe("fail");
  });

  it("a configured path that 404s fails", async () => {
    const routes = good();
    delete routes["/about"];
    const c = check(await run(await serve(routes)), "path:/about");
    expect(c.status).toBe("fail");
    expect(c.message).toContain("404");
  });

  it("a path that redirects to a page that returns 200 passes", async () => {
    const routes = good();
    routes["/about"] = (_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", "/about-us");
      res.end();
    };
    routes["/about-us"] = send("<html>", "text/html");
    expect(check(await run(await serve(routes)), "path:/about").status).toBe("pass");
  });

  it("wildcard paths are skipped, and --sample tests one", async () => {
    const report = await run(await serve(good()));
    const skipped = report.checks.find((c) => c.id === "paths:wildcards");
    expect(skipped?.status).toBe("skip");
    expect(skipped?.message).toContain("/property/*");
    expect(skipped?.message).toContain("--sample");
  });
});

describe("verify: Apple's CDN and Google's Digital Asset Links, against mock endpoints", () => {
  const publicHost = { allowHttp: false } as const;

  it("a CDN copy that matches passes", async () => {
    const cdn = await serve({ "/a/v1/example.com": send(local.get(AASA) as string) });
    const report = await verify({
      url: "https://example.com",
      config,
      appleCdn: `${cdn}/a/v1`,
      only: ["apple-cdn"],
      ...publicHost,
    });
    expect(check(report, "apple-cdn").status).toBe("pass");
  });

  it("a stale CDN copy fails and explains the CDN's caching", async () => {
    const stale = JSON.stringify({
      applinks: { details: [{ appIDs: ["OLD.com.example.app"], components: [{ "/": "*" }] }] },
    });
    const cdn = await serve({
      "/a/v1/example.com": (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Age", "7200");
        res.setHeader("Apple-From", "https://example.com/.well-known/apple-app-site-association");
        res.end(stale);
      },
    });
    const report = await verify({
      url: "https://example.com",
      config,
      appleCdn: `${cdn}/a/v1`,
      only: ["apple-cdn"],
      ...publicHost,
    });
    const c = check(report, "apple-cdn");
    expect(c.status).toBe("fail");
    expect(c.message).toMatch(/older|stale|differs/i);
    expect(c.fix).toContain("6 hours");
    expect(c.fix).toContain("24 hours");
  });

  it("a CDN 404 fails and points at the origin", async () => {
    const cdn = await serve({});
    const report = await verify({
      url: "https://example.com",
      config,
      appleCdn: `${cdn}/a/v1`,
      only: ["apple-cdn"],
      ...publicHost,
    });
    const c = check(report, "apple-cdn");
    expect(c.status).toBe("fail");
    expect(c.message).toContain("404");
  });

  it("DAL: linked true passes", async () => {
    const dal = await serve({
      "/v1/assetlinks:check": send(JSON.stringify({ linked: true, maxAge: "3600s" })),
    });
    const report = await verify({
      url: "https://example.com",
      config,
      dalApi: `${dal}/v1`,
      only: ["google-dal"],
      ...publicHost,
    });
    expect(check(report, "google-dal:com.example.app").status).toBe("pass");
  });

  it("DAL: `linked` missing means not linked (the API omits false)", async () => {
    const dal = await serve({ "/v1/assetlinks:check": send(JSON.stringify({ maxAge: "3600s" })) });
    const report = await verify({
      url: "https://example.com",
      config,
      dalApi: `${dal}/v1`,
      only: ["google-dal"],
      ...publicHost,
    });
    const c = check(report, "google-dal:com.example.app");
    expect(c.status).toBe("fail");
    expect(c.fix).toMatch(/fingerprint|Play App Signing/);
  });

  it("DAL: asks about every fingerprint, with the relation and the site", async () => {
    const urls: string[] = [];
    const dal = await serve({
      "/v1/assetlinks:check": (req, res) => {
        urls.push(req.url ?? "");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ linked: true }));
      },
    });
    const two = makeConfig({
      apps: {
        android: {
          packageName: "com.example.app",
          sha256CertFingerprints: [
            FP,
            "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
          ],
        },
      },
    });
    await verify({
      url: "https://example.com",
      config: two,
      dalApi: `${dal}/v1`,
      only: ["google-dal"],
      ...publicHost,
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("source.web.site=https%3A%2F%2Fexample.com");
    expect(urls[0]).toContain(`relation=${encodeURIComponent(HANDLE_ALL_URLS)}`);
    expect(urls[0]).toContain("target.androidApp.packageName=com.example.app");
    expect(urls[0]).toContain("target.androidApp.certificate.sha256Fingerprint=");
  });

  it("DAL: an API error fails with its message instead of throwing", async () => {
    const dal = await serve({
      "/v1/assetlinks:check": send(JSON.stringify({ error: { message: "bad" } }), "application/json", 400),
    });
    const report = await verify({
      url: "https://example.com",
      config,
      dalApi: `${dal}/v1`,
      only: ["google-dal"],
      ...publicHost,
    });
    expect(check(report, "google-dal:com.example.app").status).toBe("fail");
  });
});

describe("verify: report", () => {
  it("ok is false when any check fails, true when none do", async () => {
    expect((await run(await serve(good()))).ok).toBe(true);
    const routes = good();
    delete routes["/deeplinker.js"];
    expect((await run(await serve(routes))).ok).toBe(false);
  });

  it("only checks files the config produces", async () => {
    const small = makeConfig({ apps: { ios: { appIds: ["ABCDE12345.com.example.app"] } }, paths: undefined });
    const routes: Record<string, Handler> = {
      "/deeplinker.js": send(
        generate(small).files.find((f) => f.path === "deeplinker.js")?.content as string,
        "application/javascript",
      ),
    };
    routes["/" + AASA] = send(generate(small).files.find((f) => f.path === AASA)?.content as string);
    const report = await verify({ url: await serve(routes), config: small, allowHttp: true });
    expect(report.checks.some((c) => c.id === `file:${ASSETLINKS}`)).toBe(false);
    expect(report.checks.some((c) => c.id === `file:${AASA}`)).toBe(true);
  });
});

describe("verify: deferred deep linking endpoint", () => {
  const deferredConfig = () => makeConfig({ deferred: { enabled: true, basePath: "/dl" } });
  const ask = (url: string, over: Partial<VerifyOptions> = {}) =>
    verify({ url, config: deferredConfig(), allowHttp: true, only: ["deferred"], ...over });
  const endpoint = (): Record<string, Handler> => ({
    "/dl/click": send('{"error":"invalid_url"}', "application/json", 400),
    "/dl/match": send('{"match":"none"}'),
  });

  it("checks nothing when the config does not use it", async () => {
    const url = await serve(good());
    const report = await verify({ url, config, allowHttp: true, only: ["deferred"] });
    expect(report.checks).toEqual([]);
  });

  it("passes when both paths answer like the endpoint", async () => {
    const report = await ask(await serve(endpoint()));
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ["deferred:/dl/click", "pass"],
      ["deferred:/dl/match", "pass"],
    ]);
    expect(report.ok).toBe(true);
  });

  it("sends an empty JSON body by POST, so nothing is ever stored", async () => {
    const seen: { method?: string; body: string; type?: string }[] = [];
    const record: Handler = (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, body, type: req.headers["content-type"] });
        res.statusCode = req.url?.endsWith("click") ? 400 : 200;
        res.setHeader("Content-Type", "application/json");
        res.end(req.url?.endsWith("click") ? '{"error":"invalid_url"}' : '{"match":"none"}');
      });
    };
    await ask(await serve({ "/dl/click": record, "/dl/match": record }));
    expect(seen.map((r) => [r.method, r.body, r.type])).toEqual([
      ["POST", "{}", "application/json"],
      ["POST", "{}", "application/json"],
    ]);
  });

  it("uses the configured base path", async () => {
    const url = await serve({
      "/api/links/click": send('{"error":"invalid_url"}', "application/json", 400),
      "/api/links/match": send('{"match":"none"}'),
    });
    const report = await verify({
      url,
      config: makeConfig({ deferred: { enabled: true, basePath: "/api/links" } }),
      allowHttp: true,
      only: ["deferred"],
    });
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual([
      "deferred:/api/links/click",
      "deferred:/api/links/match",
    ]);
  });

  it("fails with the README pointer when the paths are not routed (404)", async () => {
    const report = await ask(await serve({}));
    expect(report.ok).toBe(false);
    for (const c of report.checks) {
      expect(c.status).toBe("fail");
      expect(c.fix).toContain("section 7");
    }
  });

  it("fails when a catch-all answers 200 with a web page", async () => {
    const page = send("<html>home</html>", "text/html");
    const report = await ask(await serve({ "/dl/click": page, "/dl/match": page }));
    expect(report.checks.map((c) => c.status)).toEqual(["fail", "fail"]);
    expect(report.checks[0]?.message).toContain("not the endpoint's answer");
  });

  it("fails on a redirect, which turns the POST into a GET", async () => {
    const redirect: Handler = (_req, res) => {
      res.statusCode = 301;
      res.setHeader("Location", "https://www.example.com/dl/click");
      res.end();
    };
    const report = await ask(await serve({ "/dl/click": redirect, "/dl/match": redirect }));
    expect(report.checks[0]?.message).toContain("redirects (HTTP 301)");
  });

  it("fails when click accepts an empty report (something else is answering)", async () => {
    const report = await ask(
      await serve({
        "/dl/click": (_req, res) => {
          res.statusCode = 204;
          res.end();
        },
        "/dl/match": send('{"match":"none"}'),
      }),
    );
    expect(report.checks[0]).toMatchObject({ status: "fail" });
    expect(report.checks[0]?.message).toContain("expected HTTP 400");
    expect(report.checks[1]?.status).toBe("pass");
  });

  it("fails cleanly when nothing is listening", async () => {
    const report = await ask("http://127.0.0.1:1", { timeoutMs: 1500 });
    expect(
      report.checks.every((c) => c.status === "fail" && c.message.startsWith("could not reach it")),
    ).toBe(true);
  });

  it("the setting changes the deeplinker.js config hash, so a stale runtime is noticed", async () => {
    expect(generate(deferredConfig()).hash).not.toBe(localHash);
  });
});
