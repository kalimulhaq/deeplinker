const BEGIN = "# BEGIN deeplinker";
const END = "# END deeplinker";

/** Wraps lines in the markers that let a later run find and replace exactly this block. */
export function markerBlock(lines: string[]): string {
  return [BEGIN, ...lines, END].join("\n") + "\n";
}

/**
 * Puts `block` into a file the user owns. A block from an earlier run is replaced in place; otherwise it is added
 * at the top (rules that must run first, like `.htaccess`) or at the bottom. Nothing outside the block changes.
 */
export function mergeMarkerBlock(
  existing: string | undefined,
  block: string,
  position: "top" | "bottom",
): string {
  if (existing === undefined || existing === "") return block;

  const start = existing.indexOf(BEGIN);
  const end = start < 0 ? -1 : existing.indexOf(END, start);
  if (start >= 0 && end >= 0) {
    const after = existing.slice(end + END.length).replace(/^\r?\n/, "");
    return existing.slice(0, start) + block + after;
  }
  return position === "top" ? block + "\n" + existing : existing.replace(/\n*$/, "\n") + "\n" + block;
}
