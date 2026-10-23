import { ipPrefix } from "./ip";
import { majorVersion, platformOf, primaryLanguage, signalsFromHeaders } from "./signals";
import type { ClickRecord, MatchRequest, MatchResponse, Settings, Store } from "./types";

export interface HandlerOptions {
  settings: Settings;
  store: Store;
  /** The client address. Each platform says where it is (`cf-connecting-ip`, the socket, …); the default reads `x-forwarded-for`. */
  ip?: (request: Request) => string | null | undefined;
  now?: () => number;
  id?: () => string;
}

const MAX_BODY = 4096;
const MAX_URL = 2048;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const defaultIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

/** A URL on one of your own hosts, or null. Anything else is refused: this service must not hand an app a stranger's link. */
function ownUrl(value: unknown, hosts: string[]): string | null {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return hosts.includes(url.hostname.toLowerCase()) ? value : null;
  } catch {
    return null;
  }
}

/**
 * What the Play Install Referrer API hands back is the `referrer` value of the Play URL. Google's docs do not say
 * whether that is the URL as the visitor opened it or still percent-encoded once, so both are accepted: the value as it
 * is, else decoded once. Anything that is not then a URL on one of your hosts is refused as usual.
 */
function referrerUrl(value: unknown, hosts: string[]): string | null {
  const raw = ownUrl(value, hosts);
  if (raw || typeof value !== "string") return raw;
  try {
    return ownUrl(decodeURIComponent(value), hosts);
  } catch {
    return null;
  }
}

/** How well a stored click fits the device that is asking. 0 means "not this one". */
function score(
  record: ClickRecord,
  ask: { platform: string; osMajor: string; deviceClass: string; lang: string },
): number {
  if (platformOf(record.os) !== ask.platform) return 0;
  if (ask.osMajor && record.osMajor && ask.osMajor !== record.osMajor) return 0;
  let s = ask.osMajor && record.osMajor ? 2 : 1;
  if (ask.lang && record.lang && ask.lang === record.lang) s += 1;
  if (ask.deviceClass && record.deviceClass && ask.deviceClass === record.deviceClass) s += 1;
  return s;
}

/**
 * The deferred deep link endpoint as one Web-standard handler (`Request` -> `Response`), which is what Cloudflare,
 * Vercel, Netlify and Node 18+ all speak. It answers whatever URL it is mounted at: the last path segment decides
 * (`…/click`, `…/match`).
 */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { settings, store } = options;
  const now = options.now ?? Date.now;
  const newId = options.id ?? (() => crypto.randomUUID());
  const clientIp = options.ip ?? defaultIp;

  async function readJson(
    request: Request,
  ): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY) return { ok: false, response: json(413, { error: "too_large" }) };
    const text = await request.text();
    if (text.length > MAX_BODY) return { ok: false, response: json(413, { error: "too_large" }) };
    try {
      const value: unknown = text ? JSON.parse(text) : {};
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("not an object");
      return { ok: true, value: value as Record<string, unknown> };
    } catch {
      return { ok: false, response: json(400, { error: "invalid_json" }) };
    }
  }

  async function click(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const url = ownUrl(body.value.url, settings.hosts);
    if (!url) return json(400, { error: "invalid_url" });

    // Without an address there is nothing a later match could be tied to, so nothing is kept.
    const prefix = ipPrefix(clientIp(request));
    if (prefix) {
      const signals = signalsFromHeaders(
        request.headers.get("user-agent"),
        request.headers.get("accept-language"),
      );
      await store.put({ id: newId(), url, ts: now(), ipPrefix: prefix, ...signals }, settings.ttlSeconds);
    }
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  async function match(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const ask = body.value as MatchRequest;
    const none: MatchResponse = { match: "none" };

    // Android: the Play Install Referrer already is the URL (the script put it there), so no lookup is needed.
    const referred = referrerUrl(ask.installReferrer, settings.hosts);
    if (referred) return json(200, { match: "deterministic", url: referred } satisfies MatchResponse);

    // iOS (opt-in): a URL read from the pasteboard, which the user had to allow the app to read.
    const pasted = settings.clipboard ? ownUrl(ask.clipboard, settings.hosts) : null;
    if (pasted) return json(200, { match: "clipboard", url: pasted } satisfies MatchResponse);

    const prefix = ipPrefix(clientIp(request));
    const platform = ask.platform === "ios" || ask.platform === "android" ? ask.platform : "other";
    if (!prefix || platform === "other") return json(200, none);

    const wanted = {
      platform,
      osMajor: majorVersion(ask.osVersion),
      deviceClass: typeof ask.deviceClass === "string" ? ask.deviceClass : "",
      lang: primaryLanguage(ask.language),
    };
    const candidates = (await store.findByPrefix(prefix, now()))
      .map((record) => ({ record, s: score(record, wanted) }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s || b.record.ts - a.record.ts);
    const best = candidates[0];
    if (!best) return json(200, none);

    const ties = candidates.filter((c) => c.s === best.s).length;
    await store.delete(best.record.id, best.record.ipPrefix);
    // More than one equally good click from this network: still the newest, but say we are less sure.
    const confidence = Math.round((best.s / 4 / (ties > 1 ? 2 : 1)) * 100) / 100;
    return json(200, { match: "probabilistic", url: best.record.url, confidence } satisfies MatchResponse);
  }

  return async (request) => {
    const action = new URL(request.url).pathname.replace(/\/+$/, "").split("/").pop();
    if (action !== "click" && action !== "match") return json(404, { error: "not_found" });
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { allow: "POST", "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    try {
      return await (action === "click" ? click(request) : match(request));
    } catch {
      return json(500, { error: "server_error" });
    }
  };
}
