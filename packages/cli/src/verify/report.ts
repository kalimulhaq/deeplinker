import type { Style } from "../format";

export type Status = "pass" | "fail" | "skip";

export interface Check {
  id: string;
  status: Status;
  message: string;
  /** What to do about a failure. */
  fix?: string;
}

export interface Report {
  site: string;
  checks: Check[];
  /** No check failed (skipped checks do not count against it). */
  ok: boolean;
}

const MARK: Record<Status, string> = { pass: "✓ pass", fail: "✗ FAIL", skip: "– skip" };

/** A summary table, failures with their fix, and a one-line tally. */
export function formatReport(report: Report, s: Style): string {
  const idWidth = Math.min(46, Math.max(...report.checks.map((c) => c.id.length)));
  const colour = { pass: s.green, fail: s.red, skip: s.dim } as const;
  const lines = [s.bold(`deeplinker verify ${report.site}`), ""];
  for (const c of report.checks) {
    lines.push(`${colour[c.status](MARK[c.status])}  ${c.id.padEnd(idWidth)}  ${c.message}`);
    if (c.fix) lines.push(`${" ".repeat(8)}${s.yellow("fix:")} ${c.fix}`);
  }
  const count = (status: Status) => report.checks.filter((c) => c.status === status).length;
  lines.push("", `${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped`);
  return lines.join("\n");
}
