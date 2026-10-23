import { generate } from "@deeplinker/generator";
import type { ResolvedConfig } from "@deeplinker/core";
import { CliError } from "../errors";
import {
  checkAppleCdn,
  checkDeferred,
  checkFiles,
  checkGoogleDal,
  checkPaths,
  checkRuntime,
  type Context,
  type Group,
} from "../verify/checks";
import type { Check, Report } from "../verify/report";

export interface VerifyOptions {
  /** The site to check: `https://example.com` or just `example.com`. */
  url: string;
  config: ResolvedConfig;
  /** Allow `http://`, for a local test server. The Apple and Google checks are then skipped. */
  allowHttp?: boolean;
  /** Base URL of Apple's AASA CDN. Defaults to the real one; tests point it at a mock. */
  appleCdn?: string;
  /** Base URL of the Digital Asset Links API. Defaults to the real one; tests point it at a mock. */
  dalApi?: string;
  /** Extra real paths to fetch (for wildcard `paths` patterns). */
  sample?: string[];
  timeoutMs?: number;
  /** Run only these groups of checks. */
  only?: Group[];
}

const APPLE_CDN = "https://app-site-association.cdn-apple.com/a/v1";
const DAL_API = "https://digitalassetlinks.googleapis.com/v1";

/** Hosts that Apple's CDN and Google's API cannot reach. */
function isPublic(url: URL): boolean {
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port) return false;
  if (host === "localhost" || /\.(local|localhost|test|internal)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return false;
  return host.includes(".");
}

function parseSite(input: string, allowHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new CliError(`"${input}" is not a URL. Use something like https://example.com`);
  }
  if (url.protocol === "http:" && !allowHttp) {
    throw new CliError(
      "verify checks the deployed site over https. Use --allow-http only for a local test server.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new CliError(`"${input}" must be an http(s) URL.`);
  return url;
}

/** Checks a live deployment against the local config. Never throws for a failing site: failures are in the report. */
export async function verify(opts: VerifyOptions): Promise<Report> {
  const url = parseSite(opts.url, opts.allowHttp ?? false);
  const ctx: Context = {
    site: url.origin,
    hostname: url.hostname,
    config: opts.config,
    timeoutMs: opts.timeoutMs ?? 10_000,
    publicSite: isPublic(url),
    appleCdn: (opts.appleCdn ?? APPLE_CDN).replace(/\/$/, ""),
    dalApi: (opts.dalApi ?? DAL_API).replace(/\/$/, ""),
    sample: (opts.sample ?? []).map((p) => (p.startsWith("/") ? p : `/${p}`)),
    expected: generate(opts.config),
  };

  const groups: Record<Group, (c: Context) => Promise<Check[]>> = {
    files: checkFiles,
    "apple-cdn": checkAppleCdn,
    "google-dal": checkGoogleDal,
    "deeplinker.js": checkRuntime,
    paths: checkPaths,
    deferred: checkDeferred,
  };
  const wanted = opts.only ?? (Object.keys(groups) as Group[]);
  const checks = (await Promise.all(wanted.map((g) => groups[g](ctx)))).flat();
  return { site: ctx.site, checks, ok: checks.every((c) => c.status !== "fail") };
}
