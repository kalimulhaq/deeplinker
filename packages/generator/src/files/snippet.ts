import { RUNTIME_FILE, type ResolvedConfig } from "@deeplinker/core";

/** The script tag, the only thing a page needs. deeplinker.js adds nothing to the page and changes nothing on it. */
export function buildSnippet(_c: ResolvedConfig): { script: string } {
  return { script: `<script src="/${RUNTIME_FILE}" async></script>` };
}

/** `snippet.html`: what to paste into the `<head>` of every page that should behave as a deep link. */
export function renderSnippetHtml(c: ResolvedConfig): string {
  return (
    [
      "<!-- deeplinker: paste inside <head> on every page that should deep link. -->",
      buildSnippet(c).script,
    ].join("\n") + "\n"
  );
}
