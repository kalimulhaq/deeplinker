import type { PathRule, PathRuleObject } from "@deeplinker/core";

/** Two-space JSON with a trailing newline: what people expect to see when they open a generated file. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** A string rule is shorthand for `{ path }`. */
export function ruleParts(rule: PathRule): PathRuleObject {
  return typeof rule === "string" ? { path: rule } : rule;
}
