import { parseConfig, type ResolvedConfig } from "@deeplinker/core";

export const FP =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
export const FP2 =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

/** Parses a config and fails the test with the readable error list when it is invalid. */
export function resolved(input: Record<string, unknown>): ResolvedConfig {
  const r = parseConfig({ domains: ["example.com"], ...input });
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.config;
}
