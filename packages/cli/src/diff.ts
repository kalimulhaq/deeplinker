import { diffLines } from "diff";
import type { Style } from "./format";

/**
 * A readable diff of `before` → `after`: unchanged lines with a leading space, removed with `-`, added with `+`.
 * Long unchanged stretches are collapsed so the change stays in view.
 */
export function renderDiff(before: string, after: string, style: Style, context = 3): string {
  const out: string[] = [];
  const parts = diffLines(before, after);
  parts.forEach((part, index) => {
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.added) out.push(...lines.map((l) => style.green("+" + l)));
    else if (part.removed) out.push(...lines.map((l) => style.red("-" + l)));
    else {
      const head = index === 0 ? 0 : context;
      const tail = index === parts.length - 1 ? 0 : context;
      if (lines.length <= head + tail + 1) out.push(...lines.map((l) => style.dim(" " + l)));
      else {
        out.push(...lines.slice(0, head).map((l) => style.dim(" " + l)));
        out.push(style.dim(` … ${lines.length - head - tail} unchanged lines …`));
        out.push(...lines.slice(lines.length - tail).map((l) => style.dim(" " + l)));
      }
    }
  });
  return out.join("\n");
}
