import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHandler } from "../src/handler";
import { memoryStore } from "../src/stores/memory";
import {
  defaultStorage,
  kindOf,
  renderDeferred,
  storageProblem,
  type Kind,
  type Storage,
} from "../src/templates";

const settings = {
  hosts: ["example.com", "www.example.com"],
  ttlSeconds: 3600,
  clipboard: false,
  basePath: "/dl",
};
const scratch = mkdtempSync(join(tmpdir(), "deeplinker-deferred-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const hasPhp = (() => {
  try {
    return /pdo_sqlite/.test(execFileSync("php", ["-m"], { encoding: "utf8" }));
  } catch {
    return false;
  }
})();

describe("which endpoint suits which host", () => {
  it.each([
    ["cloudflare", "cloudflare"],
    ["vercel", "vercel"],
    ["netlify", "netlify"],
    ["apache", "php"],
    ["laravel", "php"],
    ["wordpress", "php"],
    ["nginx", "node"],
    ["static", "node"],
  ] as const)("%s → %s", (host, kind) => {
    expect(kindOf(host)).toBe(kind);
  });

  it("each kind has a sensible default storage", () => {
    expect(defaultStorage("cloudflare")).toBe("kv");
    expect(defaultStorage("vercel")).toBe("redis");
    expect(defaultStorage("netlify")).toBe("redis");
    expect(defaultStorage("node")).toBe("sqlite");
    expect(defaultStorage("php")).toBe("sqlite");
  });

  it("rejects a storage the host cannot use, and says what it can", () => {
    expect(storageProblem("vercel", "kv")).toMatch(/redis, postgres/);
    expect(storageProblem("cloudflare", "redis")).toContain("kv");
    expect(storageProblem("php", "postgres")).toContain("sqlite");
    expect(storageProblem("node", "kv")).toContain("sqlite");
    expect(storageProblem("node", "redis")).toBeNull();
  });
});

describe("the PHP endpoint, as a file you put into someone else's site", () => {
  const php = renderDeferred({ host: "apache", settings }).files[0]?.content ?? "";

  it("keeps its database out of the web root by default and says how to move it", () => {
    expect(php).not.toContain("__DIR__ . '/deeplinker-deferred.sqlite'");
    expect(php).toContain("sys_get_temp_dir()");
    expect(php).toContain("@chmod($path, 0600)");
  });

  it("gives every function it declares a deeplinker prefix, so it cannot clash with a theme or a framework", () => {
    const declared = [...php.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(4);
    expect(declared.filter((n) => !(n as string).startsWith("dl_"))).toEqual([]);
  });

  it.each([
    ["apache", "your web root, as dl.php"],
    ["wordpress", "wp-content/mu-plugins/deeplinker/dl.php"],
    ["laravel", "deeplinker/dl.php"],
  ] as const)("%s: says where the file goes", (host, where) => {
    const out = renderDeferred({ host, settings });
    expect(out.files[0]?.destination).toContain(where);
    expect(out.steps.join("\n")).toContain(host === "apache" ? "web root" : where.replace("`", ""));
  });
});

describe("renderDeferred", () => {
  const combos: [Kind, Storage][] = [
    ["cloudflare", "kv"],
    ["cloudflare", "memory"],
    ["vercel", "redis"],
    ["vercel", "postgres"],
    ["vercel", "memory"],
    ["netlify", "redis"],
    ["netlify", "postgres"],
    ["netlify", "memory"],
    ["node", "memory"],
    ["node", "sqlite"],
    ["node", "postgres"],
    ["node", "redis"],
  ];
  const hostFor: Record<Kind, "cloudflare" | "vercel" | "netlify" | "nginx" | "apache"> = {
    cloudflare: "cloudflare",
    vercel: "vercel",
    netlify: "netlify",
    node: "nginx",
    php: "apache",
  };

  it.each(combos)("%s with %s writes JavaScript that parses", (kind, storage) => {
    const out = renderDeferred({ host: hostFor[kind], storage, settings });
    expect(out.files.length).toBeGreaterThan(0);
    expect(out.warnings.filter((w) => !/memory/.test(w))).toEqual([]);
    for (const file of out.files) {
      expect(file.path.startsWith(`deferred/${kind}/`), file.path).toBe(true);
      const path = join(scratch, `${kind}-${storage}-${file.path.replace(/\W/g, "_")}.mjs`);
      writeFileSync(path, file.content);
      execFileSync(process.execPath, ["--check", path]); // throws on a syntax error
    }
  });

  it("puts your hosts, the ttl and the clipboard flag in the file, as data", () => {
    const out = renderDeferred({ host: "cloudflare", settings: { ...settings, clipboard: true } });
    const code = out.files[0]?.content ?? "";
    expect(code).toContain('"example.com"');
    expect(code).toContain('"www.example.com"');
    expect(code).toContain('"ttlSeconds": 3600');
    expect(code).toContain('"clipboard": true');
  });

  it("imports the handler from the published package and nothing from the repository", () => {
    for (const [kind, storage] of combos) {
      const files = renderDeferred({ host: hostFor[kind], storage, settings }).files;
      // Vercel's two route files import the generated lib/deeplinker.mjs (a path inside the user's project); every other
      // file imports the package.
      expect(
        files.some((f) => f.content.includes('"@kalimulhaq/deeplinker/deferred"')),
        `${kind}/${storage}`,
      ).toBe(true);
      for (const file of files) {
        const own = file.content.replaceAll('"../../lib/deeplinker.mjs"', "");
        expect(own, file.path).not.toMatch(
          /packages\/|\.\.\/\.\.\/|@deeplinker\/(core|generator|runtime|cli)/,
        );
      }
    }
  });

  it("names the packages and environment variables each storage needs", () => {
    const redis = renderDeferred({ host: "vercel", storage: "redis", settings });
    expect(redis.dependencies).toEqual(["@kalimulhaq/deeplinker", "redis", "@vercel/functions"]);
    expect(redis.env).toEqual(["REDIS_URL"]);
    expect(renderDeferred({ host: "nginx", storage: "postgres", settings }).env).toEqual(["DATABASE_URL"]);
    expect(renderDeferred({ host: "cloudflare", settings }).env.join()).toContain("DEEPLINKER_KV");
  });

  it("Netlify routes the configured base path", () => {
    const out = renderDeferred({
      host: "netlify",
      storage: "redis",
      settings: { ...settings, basePath: "/api/links/" },
    });
    expect(out.files[0]?.content).toContain('"/api/links/click", "/api/links/match"');
  });

  it("Vercel splits into a shared handler and two routes that use it", () => {
    const out = renderDeferred({ host: "vercel", storage: "redis", settings });
    expect(out.files.map((f) => f.path)).toEqual([
      "deferred/vercel/lib/deeplinker.mjs",
      "deferred/vercel/api/dl/click.mjs",
      "deferred/vercel/api/dl/match.mjs",
    ]);
  });

  it("Vercel: plain ESM files (.mjs), the handler outside api/, and the client address from @vercel/functions", () => {
    const out = renderDeferred({ host: "vercel", storage: "redis", settings });
    const [shared, click] = out.files.map((f) => f.content);
    expect(shared).toContain('import { ipAddress } from "@vercel/functions";');
    expect(shared).toContain("ip: (request) => ipAddress(request)");
    expect(click).toContain('from "../../lib/deeplinker.mjs"');
    expect(click).toContain("export const POST");
    expect(out.dependencies).toContain("@vercel/functions");
    expect(out.files.filter((f) => f.path.includes("/api/")).every((f) => f.path.endsWith(".mjs"))).toBe(
      true,
    );
  });

  it("Netlify: uses the documented client address, context.ip", () => {
    const code = renderDeferred({ host: "netlify", storage: "redis", settings }).files[0]?.content ?? "";
    expect(code).toContain("export default (request, context) =>");
    expect(code).toContain("ip: () => context.ip");
  });

  it("the Node server listens on the loopback address only", () => {
    const code = renderDeferred({ host: "nginx", storage: "memory", settings }).files[0]?.content ?? "";
    expect(code).toContain('"127.0.0.1"');
  });

  it("a storage that does not fit renders nothing and says why", () => {
    const out = renderDeferred({ host: "vercel", storage: "kv", settings });
    expect(out.files).toEqual([]);
    expect(out.warnings.join()).toContain("kv");
  });

  it("warns that memory storage cannot work on serverless hosts, but not on a Node server", () => {
    expect(renderDeferred({ host: "vercel", storage: "memory", settings }).warnings.join()).toMatch(/memory/);
    expect(renderDeferred({ host: "nginx", storage: "memory", settings }).warnings).toEqual([]);
  });

  it("PHP: one file, valid syntax, no JavaScript dependencies", () => {
    const out = renderDeferred({ host: "apache", settings });
    expect(out.files.map((f) => f.path)).toEqual(["deferred/php/dl.php"]);
    expect(out.dependencies).toEqual([]);
    expect(out.files[0]?.content).toContain('"example.com"');
    expect(out.files[0]?.content).not.toMatch(
      /\beval\b|(?<!->)\bexec\(|shell_exec|\bsystem\(|passthru|proc_open|popen/,
    );
    if (hasPhp) {
      const path = join(scratch, "dl-syntax.php");
      writeFileSync(path, out.files[0]?.content ?? "");
      expect(execFileSync("php", ["-l", path], { encoding: "utf8" })).toContain("No syntax errors");
    }
  });
});

// ---- the PHP endpoint, running for real, and held to the same answers as the JavaScript handler ----
describe.skipIf(!hasPhp)("the PHP endpoint behaves like the JavaScript handler", () => {
  let server: ChildProcess | undefined;
  let base = "";

  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const URL_A = "https://example.com/property/42?a=1&a=2&b=&c=%C3%BC#top";

  async function start(clipboard = false) {
    const dir = mkdtempSync(join(scratch, "php-"));
    const file = join(dir, "dl.php");
    writeFileSync(
      file,
      renderDeferred({ host: "apache", settings: { ...settings, clipboard } }).files[0]?.content ?? "",
    );
    const port: number = await new Promise((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const p = (probe.address() as { port: number }).port;
        probe.close(() => resolve(p));
      });
    });
    server?.kill();
    server = spawn("php", ["-S", `127.0.0.1:${port}`, file], {
      env: { ...process.env, DEEPLINKER_DB: join(dir, "db.sqlite") },
      stdio: "ignore",
    });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(base + "/dl/match", { method: "POST", body: "{}" });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error("php -S did not start");
  }
  afterAll(() => void server?.kill());

  const call = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "user-agent": IPHONE, "accept-language": "en-GB,en;q=0.9", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  /** The JavaScript handler, set up the same way (the PHP server sees 127.0.0.1). */
  function js(clipboard = false) {
    const handle = createHandler({
      settings: { hosts: settings.hosts, ttlSeconds: 3600, clipboard },
      store: memoryStore(),
      ip: () => "127.0.0.1",
    });
    return async (path: string, body: unknown, headers: Record<string, string> = {}) => {
      const res = await handle(
        new Request(`https://example.com${path}`, {
          method: "POST",
          headers: { "user-agent": IPHONE, "accept-language": "en-GB,en;q=0.9", ...headers },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      );
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
  }

  it("click then match: the URL comes back byte for byte, labelled probabilistic, and only once", async () => {
    await start();
    expect((await call("/dl/click", { url: URL_A })).status).toBe(204);
    const first = await call("/dl/match", {
      platform: "ios",
      osVersion: "17.5",
      deviceClass: "phone",
      language: "en-US",
    });
    expect(first.body).toMatchObject({ match: "probabilistic", url: URL_A });
    expect(first.headers.get("content-type")).toContain("application/json");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("set-cookie")).toBeNull();
    expect((await call("/dl/match", { platform: "ios", osVersion: "17.5" })).body).toEqual({ match: "none" });
  });

  it("gives the same answers as the JavaScript handler for the same conversation", async () => {
    await start(true);
    const reference = js(true);
    const script: [string, unknown, Record<string, string>?][] = [
      ["/dl/click", { url: "https://example.com/a" }],
      ["/dl/click", { url: "https://example.com/b" }, { "accept-language": "fr-FR" }],
      ["/dl/click", { url: URL_A }, { "user-agent": ANDROID }],
      ["/dl/click", { url: "https://evil.example.org/x" }],
      ["/dl/click", "{ nope"],
      ["/dl/click", { url: "https://example.com.evil.org/x" }],
      ["/dl/match", { platform: "ios", osVersion: "16.0" }],
      ["/dl/match", { platform: "ios", osVersion: "17.2", language: "fr" }],
      ["/dl/match", { platform: "ios", osVersion: "17.2", language: "en" }],
      ["/dl/match", { platform: "android", osVersion: "13", deviceClass: "phone" }],
      ["/dl/match", { platform: "android", installReferrer: URL_A }],
      ["/dl/match", { platform: "android", installReferrer: encodeURIComponent(URL_A) }],
      ["/dl/match", { platform: "android", installReferrer: "https://example.com/p?c=%C3%BC&q=a%2Bb" }],
      ["/dl/match", { platform: "android", installReferrer: "https%3A%2F%2Fexample.com%2Fa%ZZ" }],
      ["/dl/match", { platform: "android", installReferrer: "https%3A%2F%2Fexample.com%2F%FF" }],
      [
        "/dl/match",
        { platform: "android", installReferrer: encodeURIComponent("https://evil.example.org/x") },
      ],
      ["/dl/match", { platform: "ios", clipboard: "https://example.com/pasted" }],
      ["/dl/match", { platform: "ios", clipboard: "text I copied" }],
      ["/dl/match", { platform: "other" }],
      ["/dl/match", {}],
      ["/dl/nope", {}],
    ];
    for (const [path, body, headers] of script) {
      const php = await call(path, body, headers);
      const ref = await reference(path, body, headers);
      expect({ path, status: php.status, body: php.body }, JSON.stringify(body)).toEqual({
        path,
        status: ref.status,
        body: ref.body,
      });
    }
  });

  it("without DEEPLINKER_DB the database is created in the temp folder, private, and never next to the script", async () => {
    const dir = mkdtempSync(join(scratch, "php-default-"));
    const tmp = mkdtempSync(join(scratch, "tmp-"));
    const file = join(dir, "dl.php");
    writeFileSync(file, renderDeferred({ host: "apache", settings }).files[0]?.content ?? "");
    const port: number = await new Promise((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const p = (probe.address() as { port: number }).port;
        probe.close(() => resolve(p));
      });
    });
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp };
    delete env.DEEPLINKER_DB;
    const child = spawn("php", ["-S", `127.0.0.1:${port}`, file], { env, stdio: "ignore" });
    try {
      let res: Response | undefined;
      for (let i = 0; i < 50 && !res; i++) {
        res = await fetch(`http://127.0.0.1:${port}/dl/click`, {
          method: "POST",
          body: JSON.stringify({ url: URL_A }),
        }).catch(() => undefined);
        if (!res) await new Promise((r) => setTimeout(r, 50));
      }
      expect(res?.status).toBe(204);
      const made = readdirSync(tmp).filter((n) => /^deeplinker-[0-9a-f]{12}\.sqlite$/.test(n));
      expect(made).toHaveLength(1);
      expect(statSync(join(tmp, made[0] as string)).mode & 0o777).toBe(0o600);
      expect(readdirSync(dir)).toEqual(["dl.php"]);
    } finally {
      child.kill();
    }
  });

  it("refuses a GET with 405, an oversized body with 413, and a foreign URL with 400", async () => {
    await start();
    const get = await fetch(base + "/dl/click");
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await call("/dl/click", { url: URL_A, pad: "x".repeat(5000) })).status).toBe(413);
    expect((await call("/dl/click", { url: "javascript:alert(1)" })).status).toBe(400);
  });

  it("keeps the /24 and coarse facts, not the address or the user agent", async () => {
    await start();
    await call("/dl/click", { url: URL_A });
    const dir = server?.spawnargs[3]?.replace(/dl\.php$/, "") ?? "";
    const rows = execFileSync(
      "php",
      [
        "-r",
        `$d=new PDO('sqlite:${dir}db.sqlite');echo json_encode($d->query('SELECT * FROM deeplinker_clicks')->fetchAll(PDO::FETCH_ASSOC));`,
      ],
      { encoding: "utf8" },
    );
    const [row] = JSON.parse(rows);
    expect(row).toMatchObject({
      prefix: "127.0.0.0/24",
      os: "ios",
      os_major: "17",
      device: "phone",
      lang: "en",
      url: URL_A,
    });
    expect(rows).not.toContain("127.0.0.1");
    expect(rows).not.toContain("Mozilla");
  });
});
