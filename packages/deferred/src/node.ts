import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY = 8192;

/**
 * Adapts the Web-standard handler to `http.createServer`. The socket address is passed along as `x-forwarded-for` when
 * a proxy has not already set it, so the handler sees one header whichever way the request arrived.
 */
export function toNodeListener(handle: (request: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      if (!headers.has("x-forwarded-for") && req.socket.remoteAddress)
        headers.set("x-forwarded-for", req.socket.remoteAddress);

      let body: string | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_BODY) {
            res
              .writeHead(413, { "content-type": "application/json" })
              .end(JSON.stringify({ error: "too_large" }));
            return;
          }
          chunks.push(chunk as Buffer);
        }
        body = Buffer.concat(chunks).toString("utf8");
      }

      const response = await handle(
        new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
          method: req.method,
          headers,
          body,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "server_error" }));
    }
  };
}
