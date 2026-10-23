/**
 * Compiles the wildcard syntax shared by Apple's `components`, Android's dynamic rules and Windows' path lists:
 * `*` is zero or more characters, `?` is exactly one, `?*` is one or more. Everything else is literal. `[^]` is used
 * instead of `.` because a decoded query value can hold a line break, which `.` does not match.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "?" && pattern.charAt(i + 1) === "*") {
      source += "[^]+";
      i++;
    } else if (c === "*") source += "[^]*";
    else if (c === "?") source += "[^]";
    else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + source + "$");
}
