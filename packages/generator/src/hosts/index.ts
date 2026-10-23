import type { HostId } from "@deeplinker/core";
import type { HostContext, HostOutput } from "../types";
import { renderApache } from "./apache";
import { renderCloudflare } from "./cloudflare";
import { renderLaravel } from "./laravel";
import { renderNetlify } from "./netlify";
import { renderNginx } from "./nginx";
import { renderVercel } from "./vercel";
import { renderWordPress } from "./wordpress";

const STATIC: HostOutput = {
  files: [],
  steps: [
    "Upload the `.well-known/` folder and `deeplinker.js` to the root of your site.",
    "Make sure your server sends `/.well-known/apple-app-site-association` and `/.well-known/windows-app-web-link` with `Content-Type: application/json` (most servers send `application/octet-stream` for files with no extension).",
  ],
  notes: [],
  warnings: [],
};

export function renderHost(id: HostId, ctx: HostContext): HostOutput {
  switch (id) {
    case "apache":
      return renderApache(ctx);
    case "nginx":
      return renderNginx(ctx);
    case "vercel":
      return renderVercel(ctx);
    case "netlify":
      return renderNetlify(ctx);
    case "cloudflare":
      return renderCloudflare(ctx);
    case "laravel":
      return renderLaravel(ctx);
    case "wordpress":
      return renderWordPress(ctx);
    default:
      return STATIC;
  }
}

export const HOST_LABEL: Record<HostId, string> = {
  apache: "Apache",
  nginx: "nginx",
  vercel: "Vercel",
  netlify: "Netlify",
  cloudflare: "Cloudflare Pages",
  laravel: "Laravel",
  wordpress: "WordPress",
  static: "a plain static host",
};
