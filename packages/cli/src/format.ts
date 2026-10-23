const codes = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, cyan: 36 } as const;

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
}

/** ANSI colour helpers that do nothing when colour is off (not a terminal, `NO_COLOR` set, or a test). */
export function styler(enabled: boolean): Style {
  const wrap = (code: number) => (text: string) => (enabled ? `\u001B[${code}m${text}\u001B[0m` : text);
  return Object.fromEntries(
    Object.entries(codes).map(([name, code]) => [name, wrap(code)]),
  ) as unknown as Style;
}

/** Colour only when writing to a terminal and the user has not asked for none (https://no-color.org). */
export function colorEnabled(isTTY: boolean | undefined, env: Record<string, string | undefined>): boolean {
  return Boolean(isTTY) && !("NO_COLOR" in env) && env.TERM !== "dumb";
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
