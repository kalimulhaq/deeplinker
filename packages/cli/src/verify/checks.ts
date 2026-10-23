import { HANDLE_ALL_URLS, RUNTIME_FILE, type ResolvedConfig } from "@deeplinker/core";
import type { generate } from "@deeplinker/generator";
import { canonicalJson, get, postJson, type Response } from "./http";
import type { Check } from "./report";

export type Group = "files" | "apple-cdn" | "google-dal" | "deeplinker.js" | "paths" | "deferred";

export interface Context {
  /** `https://example.com`, no trailing slash. */
  site: string;
  hostname: string;
  config: ResolvedConfig;
  timeoutMs: number;
  /** Whether Apple's CDN and Google's API can reach this site at all. */
  publicSite: boolean;
  appleCdn: string;
  dalApi: string;
  sample: string[];
  expected: ReturnType<typeof generate>;
}

const pass = (id: string, message: string): Check => ({ id, status: "pass", message });
const fail = (id: string, message: string, fix: string): Check => ({ id, status: "fail", message, fix });
const skip = (id: string, message: string): Check => ({ id, status: "skip", message });

const NOT_PUBLIC =
  "the site is not a public https address, which Apple's CDN and Google's API need to reach it";

function contentType(res: Response): string {
  return (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** The association files the config produces, each fetched without following redirects. */
export async function checkFiles(ctx: Context): Promise<Check[]> {
  const files = ctx.expected.files.filter((f) => f.path.startsWith(".well-known/"));
  return Promise.all(
    files.map(async (file): Promise<Check> => {
      const id = `file:${file.path}`;
      const url = `${ctx.site}/${file.path}`;
      const res = await get(url, { timeoutMs: ctx.timeoutMs, follow: false });

      if (res.error)
        return fail(
          id,
          `could not fetch ${url}: ${res.error}`,
          "Check the domain, the certificate and that the server is running.",
        );
      if (res.status >= 300 && res.status < 400) {
        return fail(
          id,
          `redirects (HTTP ${res.status}) to ${res.headers.get("location") ?? "somewhere else"}`,
          "Serve the file directly at this exact URL: Apple, Google and Microsoft all reject a redirected association file. Look at http→https and www rules, trailing-slash rules and framework catch-alls; they must skip /.well-known/.",
        );
      }
      if (res.status !== 200) {
        return fail(
          id,
          `HTTP ${res.status}`,
          `Upload ${file.path} so that ${url} returns it. Your server must not require a login or block unknown visitors for this path.`,
        );
      }
      if (contentType(res) !== "application/json") {
        return fail(
          id,
          `Content-Type is ${contentType(res) || "missing"}, expected application/json`,
          "Send `Content-Type: application/json` for this file. The deploy README lists the setting for your host.",
        );
      }
      let live: unknown;
      try {
        live = JSON.parse(res.body);
      } catch (error) {
        return fail(
          id,
          `not valid JSON (${(error as Error).message})`,
          "Upload the generated file unchanged; check that nothing (a minifier, a CDN, a login page) rewrote it.",
        );
      }
      if (canonicalJson(live) !== canonicalJson(JSON.parse(file.content))) {
        return fail(
          id,
          "differs from your local build",
          "Run `npx deeplinker build` and upload the new file. If you just did, a CDN or cache in front of the site may still be serving the old one.",
        );
      }
      return pass(id, "200 · application/json · matches your config");
    }),
  );
}

/** Apple fetches association files through its own CDN, so a stale copy there is a common cause of "it does not work". */
export async function checkAppleCdn(ctx: Context): Promise<Check[]> {
  const local = ctx.expected.files.find((f) => f.path === ".well-known/apple-app-site-association");
  if (!local) return [];
  const id = "apple-cdn";
  if (!ctx.publicSite) return [skip(id, NOT_PUBLIC)];

  const url = `${ctx.appleCdn}/${ctx.hostname}`;
  const res = await get(url, { timeoutMs: ctx.timeoutMs, follow: false });
  if (res.error) return [skip(id, `could not reach Apple's CDN (${res.error}); check by hand: ${url}`)];

  const cached = res.headers.get("age") ? ` (cached ${res.headers.get("age")} s ago)` : "";
  if (res.status === 404) {
    return [
      fail(
        id,
        "Apple's CDN returned 404 for this domain",
        "Apple has no copy: the file was missing, redirected or blocked the last time its servers asked. Fix the live file first (see the file check above, and let Apple's servers in: no IP allow-lists or bot walls); Apple fetches again within 24 hours.",
      ),
    ];
  }
  if (res.status !== 200)
    return [
      fail(
        id,
        `Apple's CDN answered HTTP ${res.status}`,
        "Try again later; if it persists, check the live file with the check above.",
      ),
    ];

  let theirs: unknown;
  try {
    theirs = JSON.parse(res.body);
  } catch {
    return [
      fail(
        id,
        "Apple's CDN returned something that is not JSON",
        "Fix the live file first (see the file check above).",
      ),
    ];
  }
  if (canonicalJson(theirs) === canonicalJson(JSON.parse(local.content))) {
    const from = res.headers.get("apple-from");
    return [pass(id, `Apple's copy matches${cached}${from ? `, fetched from ${from}` : ""}`)];
  }
  return [
    fail(
      id,
      `Apple's copy is older than yours or differs from it${cached}`,
      "Apple's CDN caches the file for up to 6 hours (Cache-Control: max-age=21600) and fetches a changed file within 24 hours; there is no way to force it, and iPhones re-check about once a week. If the live file passes the check above, wait. To test sooner, use `applinks:" +
        ctx.hostname +
        "?mode=developer` in the app's entitlement.",
    ),
  ];
}

/** Google's Digital Asset Links API says whether it sees each app linked to the site. */
export async function checkGoogleDal(ctx: Context): Promise<Check[]> {
  const local = ctx.expected.files.find((f) => f.path === ".well-known/assetlinks.json");
  if (!local) return [];
  const statements = JSON.parse(local.content) as {
    target: { package_name: string; sha256_cert_fingerprints: string[] };
  }[];

  return Promise.all(
    statements.map(async ({ target }): Promise<Check> => {
      const id = `google-dal:${target.package_name}`;
      if (!ctx.publicSite) return skip(id, NOT_PUBLIC);

      const unlinked: string[] = [];
      for (const fingerprint of target.sha256_cert_fingerprints) {
        const query = new URLSearchParams({
          "source.web.site": ctx.site,
          relation: HANDLE_ALL_URLS,
          "target.androidApp.packageName": target.package_name,
          "target.androidApp.certificate.sha256Fingerprint": fingerprint,
        });
        const res = await get(`${ctx.dalApi}/assetlinks:check?${query}`, {
          timeoutMs: ctx.timeoutMs,
          follow: false,
        });
        if (res.error) return skip(id, `could not reach Google's Digital Asset Links API (${res.error})`);
        let body: { linked?: boolean; error?: { message?: string } } = {};
        try {
          body = JSON.parse(res.body);
        } catch {
          /* handled below */
        }
        if (res.status !== 200)
          return fail(
            id,
            `Google's API answered HTTP ${res.status}${body.error?.message ? `: ${body.error.message}` : ""}`,
            "Check that the site is reachable, then run verify again.",
          );
        // The API leaves `linked` out instead of sending false.
        if (body.linked !== true) unlinked.push(fingerprint);
      }
      if (!unlinked.length)
        return pass(
          id,
          `Google sees ${target.package_name} linked to ${ctx.hostname} (${target.sha256_cert_fingerprints.length} certificate${target.sha256_cert_fingerprints.length > 1 ? "s" : ""})`,
        );
      return fail(
        id,
        `Google does not see ${target.package_name} linked with ${unlinked.length === target.sha256_cert_fingerprints.length ? "any of its certificates" : (unlinked[0] as string)}`,
        "Check that assetlinks.json is live (the file check above) and that the fingerprint is the one that signs the app people install. With Play App Signing that is Google's key, not your upload key: see Play Console → App integrity.",
      );
    }),
  );
}

/** deeplinker.js must load as JavaScript and be built from this config. */
export async function checkRuntime(ctx: Context): Promise<Check[]> {
  const id = RUNTIME_FILE;
  const res = await get(`${ctx.site}/${RUNTIME_FILE}`, { timeoutMs: ctx.timeoutMs, follow: true });
  if (res.error)
    return [fail(id, `could not fetch it: ${res.error}`, "Upload deeplinker.js to the root of the site.")];
  if (res.status !== 200)
    return [
      fail(id, `HTTP ${res.status}`, `Upload deeplinker.js so that ${ctx.site}/${RUNTIME_FILE} returns it.`),
    ];
  if (!/javascript|ecmascript/.test(contentType(res))) {
    return [
      fail(
        id,
        `served as ${contentType(res) || "an unknown type"}, not JavaScript`,
        "This is usually a catch-all route returning your home page for a missing file. Upload deeplinker.js to the site root.",
      ),
    ];
  }
  const live = /^\/\*! \S+ config:([0-9a-f]{14}) \*\//.exec(res.body)?.[1];
  if (!live)
    return [
      fail(
        id,
        "it does not look like a file `deeplinker build` made (no config banner)",
        "Upload the deeplinker.js from deeplinker-dist/.",
      ),
    ];
  if (live !== ctx.expected.hash) {
    return [
      fail(
        id,
        `built from a different config (live ${live}, local ${ctx.expected.hash})`,
        "Run `npx deeplinker build` and upload the new deeplinker.js.",
      ),
    ];
  }
  return [pass(id, `200 · JavaScript · config ${live} matches`)];
}

/**
 * The deferred deep linking endpoint, when the config turns it on. Both requests are harmless: an empty body is never
 * stored. `click` must refuse it (400, because there is no URL) and `match` must answer "none"; an HTML page, a 404 or
 * a redirect means the two paths are not routed to the endpoint.
 */
export async function checkDeferred(ctx: Context): Promise<Check[]> {
  if (!ctx.config.deferred.enabled) return [];
  const base = ctx.config.deferred.basePath.replace(/\/+$/, "");
  const where = "The deploy README (section 7) lists what to copy and which rule routes the two paths.";

  const ask = async (
    action: "click" | "match",
    ok: (res: Response, json: Record<string, unknown>) => string | null,
  ) => {
    const id = `deferred:${base}/${action}`;
    const url = `${ctx.site}${base}/${action}`;
    const res = await postJson(url, {}, { timeoutMs: ctx.timeoutMs });
    if (res.error)
      return fail(
        id,
        `could not reach it: ${res.error}`,
        "Check the domain, the certificate and that the endpoint is deployed.",
      );
    if (res.status >= 300 && res.status < 400)
      return fail(
        id,
        `redirects (HTTP ${res.status}) to ${res.headers.get("location") ?? "somewhere else"}`,
        "A redirected POST becomes a GET and the report is lost. Serve the endpoint at this exact URL (http→https and www rules must skip it).",
      );
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(res.body || "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        json = parsed as Record<string, unknown>;
    } catch {
      /* not JSON: handled below */
    }
    if (!json && !(action === "click" && res.status === 204)) {
      return fail(
        id,
        `HTTP ${res.status}, ${contentType(res) || "no content type"}: this is not the endpoint's answer`,
        `The path is probably answered by something else (a 404 page or a catch-all route). ${where}`,
      );
    }
    const problem = ok(res, json ?? {});
    return problem
      ? fail(id, problem, where)
      : pass(id, `HTTP ${res.status} · ${action === "click" ? "refuses an empty report" : "answers JSON"}`);
  };

  return Promise.all([
    ask("click", (res, json) =>
      res.status === 400 && typeof json.error === "string"
        ? null
        : `expected HTTP 400 for an empty report, got ${res.status}`,
    ),
    ask("match", (res, json) =>
      res.status === 200 && typeof json.match === "string"
        ? null
        : `expected HTTP 200 with a "match" field, got ${res.status}`,
    ),
  ]);
}

const isConcrete = (path: string) => !/[*?]/.test(path);

/** Concrete configured paths (and any `--sample`) must answer 200. Wildcard patterns cannot be fetched as they are. */
export async function checkPaths(ctx: Context): Promise<Check[]> {
  const patterns = (ctx.config.paths?.include ?? [])
    .map((r) => (typeof r === "string" ? r : r.path))
    .filter((p): p is string => p !== undefined);
  const concrete = [...patterns.filter(isConcrete), ...ctx.sample].filter(
    (p, i, all) => all.indexOf(p) === i,
  );
  const wildcards = patterns.filter((p) => !isConcrete(p));

  const checks = await Promise.all(
    concrete.map(async (path): Promise<Check> => {
      const id = `path:${path}`;
      const res = await get(`${ctx.site}${path}`, { timeoutMs: ctx.timeoutMs, follow: true });
      if (res.error) return fail(id, `could not fetch it: ${res.error}`, "Check that the site is up.");
      if (res.status !== 200) {
        return fail(
          id,
          `HTTP ${res.status}`,
          "This path is configured as a deep link but the page does not exist. Fix the path in `paths`, or the site.",
        );
      }
      return pass(id, res.hops.length ? `200 (after redirecting to ${res.url})` : "200");
    }),
  );
  if (wildcards.length && !ctx.sample.length) {
    checks.push(
      skip(
        "paths:wildcards",
        `${wildcards.join(", ")} cannot be fetched as patterns; pass --sample <path> (for example --sample ${wildcards[0]?.replace(/[*?]+/, "1")}) to test a real page`,
      ),
    );
  }
  return checks;
}
