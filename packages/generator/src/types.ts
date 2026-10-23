import type { ResolvedConfig } from "@deeplinker/core";

/** One file the generator wants written. `path` is relative to the output directory, with forward slashes. */
export interface GeneratedFile {
  path: string;
  content: string;
  /** One line, for the build summary and the deploy README. */
  description: string;
  /** Where it goes on the server or in the project, when that is not simply "the same path under the web root". */
  destination?: string;
  /** Set when this file was produced by merging into one of the user's own files: their original content. */
  before?: string;
}

/** The user's existing files, read by the caller (the generator itself never touches a file system). */
export interface ExistingFiles {
  manifest?: string;
  htaccess?: string;
  vercelJson?: string;
  /** Netlify and Cloudflare Pages `_headers`. */
  headers?: string;
  routesJson?: string;
}

export interface WellKnownFile {
  /** Relative to the output directory, e.g. `.well-known/assetlinks.json`. */
  path: string;
  content: string;
}

/** Set when the deferred deep linking endpoint was generated: the host adds the rule that sends its two paths to it. */
export interface DeferredRouting {
  /** `/dl`, never with a trailing slash. The paths are `<basePath>/click` and `<basePath>/match`. */
  basePath: string;
}

export interface HostContext {
  config: ResolvedConfig;
  wellKnown: WellKnownFile[];
  existing: ExistingFiles;
  deferred?: DeferredRouting;
}

export interface HostOutput {
  files: GeneratedFile[];
  /** Plain-language steps for README-DEPLOY.md. */
  steps: string[];
  notes: string[];
  warnings: string[];
}

/** A generated value plus anything the user should know about how faithfully their config could be expressed. */
export interface Built<T> {
  /** null when the config does not call for this file. */
  value: T | null;
  warnings: string[];
}

export type Json = Record<string, unknown>;
