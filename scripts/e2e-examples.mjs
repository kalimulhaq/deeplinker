// End to end: the packed @kalimulhaq/deeplinker, run the way a user would run it, on every project in examples/.
//
//   pnpm --filter @kalimulhaq/deeplinker build && pnpm e2e:examples
//
// 1. `npm pack` the kit and install the tarball once into a scratch folder.
// 2. For each example: copy it to a temp dir; run `deeplinker init --yes` if it has no config; run `deeplinker build`.
// 3. Serve deeplinker-dist on localhost the way a correctly configured host would (association files as JSON), and run
//    `deeplinker verify --allow-http` against it.
//
// What this proves: the published package installs and runs, `build` works on each kind of project, and what it
// generates is what `verify` expects to find. What it cannot prove: how a real host, Apple's CDN or Google's API behave
// (the Apple and Google checks are skipped for a local address). The README's "Testing on real devices" section covers those by hand.
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kitDir = resolve(root, "packages/deeplinker");
const examplesDir = resolve(root, "examples");

if (!existsSync(resolve(kitDir, "dist/cli.js"))) {
  console.error("The kit is not built. Run: pnpm --filter @kalimulhaq/deeplinker build");
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "deeplinker-e2e-"));
const results = [];
let servers = [];
const children = [];

const freePort = () =>
  new Promise((done) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

try {
  // 1. Pack and install once.
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch], {
      cwd: kitDir,
      encoding: "utf8",
    }),
  );
  const tarball = join(scratch, packed[0].filename);
  const toolbox = join(scratch, "toolbox");
  mkdirSync(toolbox);
  writeFileSync(join(toolbox, "package.json"), JSON.stringify({ name: "toolbox", private: true }));
  console.log(`Installing ${packed[0].filename} (${(packed[0].size / 1024).toFixed(0)} KB) once...`);
  execFileSync(
    "npm",
    ["install", tarball, "--no-audit", "--no-fund", "--loglevel=error", "--prefer-offline"],
    { cwd: toolbox, stdio: "inherit" },
  );
  const bin = join(toolbox, "node_modules/@kalimulhaq/deeplinker/bin/deeplinker.js");

  const deeplinker = (cwd, args) =>
    new Promise((done) => {
      const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, NO_COLOR: "1" } });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("close", (code) => done({ code, output }));
    });

  // 2 + 3. Every example.
  // An empty folder as well, so `init --yes` is part of the journey: init, build, verify.
  const blank = join(scratch, "blank-src");
  mkdirSync(blank);
  const projects = [
    ...readdirSync(examplesDir)
      .sort()
      .map((name) => ({ name, source: join(examplesDir, name) }))
      .filter((p) => statSync(p.source).isDirectory()),
    { name: "blank folder (init --yes)", source: blank },
  ];

  for (const { name, source } of projects) {
    const steps = [];
    const record = (step, ok, detail = "") => steps.push({ step, ok, detail });

    const work = join(scratch, "work", name.replace(/\W+/g, "-"));
    cpSync(source, work, { recursive: true });
    symlinkSync(join(toolbox, "node_modules"), join(work, "node_modules"), "dir");

    if (!readdirSync(work).some((f) => f.startsWith("deeplinker.config."))) {
      const init = await deeplinker(work, ["init", "--yes", "--domains", "example.com"]);
      record("init --yes", init.code === 0, init.output.trim());
    }

    const built = await deeplinker(work, ["build"]);
    record(
      "build",
      built.code === 0 && !/Unexpected error/.test(built.output),
      built.code === 0 ? "" : built.output.trim(),
    );
    const dist = join(work, "deeplinker-dist");
    record("README-DEPLOY.md written", existsSync(join(dist, "README-DEPLOY.md")));
    record(
      "no warnings from the build",
      !/⚠/.test(built.output),
      built.output
        .split("\n")
        .filter((l) => l.includes("⚠"))
        .join("; "),
    );

    // Deferred deep linking: run the generated Node endpoint the way its README says, and put the same kind of
    // reverse proxy in front of it that nginx would be (the client address is replaced, not appended to).
    let deferredPort = 0;
    const endpoint = join(dist, "deferred/node/server.mjs");
    if (existsSync(endpoint)) {
      if (Number(process.versions.node.split(".")[0]) < 20) {
        record("deferred endpoint (needs Node 20+)", true, "skipped on this Node version");
      } else {
        deferredPort = await freePort();
        let log = "";
        const child = spawn(process.execPath, [endpoint], {
          cwd: dist,
          env: { ...process.env, PORT: String(deferredPort) },
        });
        child.stdout.on("data", (d) => (log += d));
        child.stderr.on("data", (d) => (log += d));
        children.push(child);
        let up = false;
        for (let i = 0; i < 60 && !up; i++) {
          up = await fetch(`http://127.0.0.1:${deferredPort}/dl/match`, { method: "POST", body: "{}" }).then(
            () => true,
            () => false,
          );
          if (!up) await new Promise((r) => setTimeout(r, 100));
        }
        record("deferred endpoint starts", up, log.trim());
        if (!up) deferredPort = 0;
      }
    }

    if (existsSync(dist)) {
      // A site: serve deeplinker-dist as it would be deployed, answer 200 for every other page.
      const server = createServer((req, res) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
        if (deferredPort && /^\/dl\/(click|match)$/.test(path)) {
          const upstream = httpRequest(
            {
              host: "127.0.0.1",
              port: deferredPort,
              path: req.url,
              method: req.method,
              headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress },
            },
            (reply) => {
              res.writeHead(reply.statusCode ?? 502, reply.headers);
              reply.pipe(res);
            },
          );
          upstream.on("error", () => {
            res.statusCode = 502;
            res.end("bad gateway");
          });
          req.pipe(upstream);
          return;
        }
        const file = join(dist, path);
        if (path.startsWith("/.well-known/") || path === "/deeplinker.js") {
          if (existsSync(file) && statSync(file).isFile()) {
            res.setHeader(
              "Content-Type",
              path.endsWith(".js") ? "application/javascript" : "application/json",
            );
            res.end(readFileSync(file));
          } else {
            res.statusCode = 404;
            res.end("not found");
          }
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><title>page</title>");
      });
      servers.push(server);
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const url = `http://127.0.0.1:${server.address().port}`;

      const verified = await deeplinker(work, [
        "verify",
        url,
        "--allow-http",
        "--sample",
        "/property/42",
        "--timeout",
        "5000",
      ]);
      record("verify", verified.code === 0, verified.code === 0 ? "" : verified.output.trim());

      if (deferredPort) {
        record(
          "verify checked the deferred endpoint",
          /deferred:\/dl\/click/.test(verified.output) && /deferred:\/dl\/match/.test(verified.output),
          verified.output.trim(),
        );
        const post = (path, body, headers = {}) =>
          fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) }).then(async (r) => ({
            status: r.status,
            json: r.status === 204 ? null : await r.json(),
          }));
        const PAGE = "https://example.com/property/42?a=1&a=2&b=&c=%C3%BC#top";
        const IPHONE =
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

        const click = await post(
          "/dl/click",
          { url: PAGE },
          { "user-agent": IPHONE, "accept-language": "en-GB" },
        );
        record("click is accepted (204)", click.status === 204, JSON.stringify(click));
        const match = await post("/dl/match", {
          platform: "ios",
          osVersion: "17.5",
          deviceClass: "phone",
          language: "en",
        });
        record(
          "an iOS match returns the page byte for byte, labelled probabilistic",
          match.json?.match === "probabilistic" && match.json?.url === PAGE,
          JSON.stringify(match),
        );
        const again = await post("/dl/match", {
          platform: "ios",
          osVersion: "17.5",
          deviceClass: "phone",
          language: "en",
        });
        record("a click is used once", again.json?.match === "none", JSON.stringify(again));
        const referrer = await post("/dl/match", { platform: "android", installReferrer: PAGE });
        record(
          "an Android Install Referrer is deterministic",
          referrer.json?.match === "deterministic" && referrer.json?.url === PAGE,
          JSON.stringify(referrer),
        );
        const foreign = await post("/dl/click", { url: "https://evil.example/x" });
        record("a URL on another domain is refused (400)", foreign.status === 400, JSON.stringify(foreign));
      }
    }
    results.push({ name, steps });
  }
} finally {
  for (const s of servers) s.close();
  for (const c of children) c.kill();
  if (process.env.E2E_KEEP) console.log(`Kept ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}

let failed = 0;
for (const { name, steps } of results) {
  console.log(`\n${name}`);
  for (const { step, ok, detail } of steps) {
    console.log(`  ${ok ? "✓" : "✗"} ${step}`);
    if (!ok) {
      failed++;
      if (detail)
        console.log(
          detail
            .split("\n")
            .map((l) => `      ${l}`)
            .join("\n"),
        );
    }
  }
}
console.log(`\n${results.length} examples, ${failed ? `${failed} step(s) failed` : "every step passed"}`);
process.exit(failed ? 1 : 0);
