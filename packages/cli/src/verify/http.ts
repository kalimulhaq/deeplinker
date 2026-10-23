export interface Response {
  /** Set when the request never produced an HTTP response (DNS, connection refused, timeout). */
  error?: string;
  status: number;
  headers: Headers;
  body: string;
  /** The URL the response came from, after any redirects that were followed. */
  url: string;
  /** Redirect hops that were followed. */
  hops: string[];
}

const NO_RESPONSE = (error: string, url: string): Response => ({
  error,
  status: 0,
  headers: new Headers(),
  body: "",
  url,
  hops: [],
});

/**
 * GET with a timeout. `follow: false` returns a 3xx as it is: association files must be served without any redirect,
 * so the redirect itself is the finding. With `follow: true` up to five hops are followed.
 */
export async function get(url: string, opts: { timeoutMs: number; follow: boolean }): Promise<Response> {
  const hops: string[] = [];
  let current = url;
  for (let i = 0; i <= 5; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "deeplinker-verify", accept: "*/*" },
      });
      const location = res.headers.get("location");
      if (opts.follow && res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        hops.push(current);
        continue;
      }
      return { status: res.status, headers: res.headers, body: await res.text(), url: current, hops };
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const reason = controller.signal.aborted
        ? `no answer within ${opts.timeoutMs} ms`
        : (cause?.code ?? cause?.message ?? (error as Error).message);
      return NO_RESPONSE(String(reason), current);
    } finally {
      clearTimeout(timer);
    }
  }
  return NO_RESPONSE("too many redirects", current);
}

/** POST a JSON body with a timeout. Redirects are never followed: a POST that is redirected is the finding. */
export async function postJson(url: string, body: unknown, opts: { timeoutMs: number }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "deeplinker-verify",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: await res.text(), url, hops: [] };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const reason = controller.signal.aborted
      ? `no answer within ${opts.timeoutMs} ms`
      : (cause?.code ?? cause?.message ?? (error as Error).message);
    return NO_RESPONSE(String(reason), url);
  } finally {
    clearTimeout(timer);
  }
}

/** JSON with keys in a fixed order, so two files that differ only in formatting or key order compare equal. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
}
