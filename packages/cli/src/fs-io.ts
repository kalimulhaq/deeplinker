import type { ExistingFiles } from "@deeplinker/generator";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CliError } from "./errors";

const SKIP = new Set(["node_modules", ".git", ".turbo", ".next", ".nuxt"]);
const ROOTS = ["", "public", "static", "dist", "build", "web", "www", "public_html", "src"];

export interface ProjectScan {
  /** File names (relative paths) used to detect the host. Root entries, plus one level inside the usual web roots. */
  files: string[];
  /** The user's own files that `build` merges into, read as text. */
  existing: ExistingFiles;
  /** Where each of those was found, relative to the project. */
  found: Partial<Record<keyof ExistingFiles, string>>;
}

function firstExisting(cwd: string, candidates: string[], outDir: string): string | undefined {
  return candidates.find((rel) => {
    const abs = resolve(cwd, rel);
    return existsSync(abs) && abs !== outDir && !abs.startsWith(outDir + sep);
  });
}

/**
 * Looks at the project (read-only) for what host it runs on and for existing files to merge into. Anything under
 * `outDir` is ignored: those are our own earlier outputs, not the user's files.
 */
export function scanProject(cwd: string, manifestPath: string, outDir: string): ProjectScan {
  const files: string[] = [];
  for (const root of ["", "public", "static", "web", "www", "public_html"]) {
    const dir = resolve(cwd, root);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const rel = root ? `${root}/${name}` : name;
      if (resolve(cwd, rel) === outDir) continue;
      files.push(rel);
    }
  }

  const where = (names: string[]) =>
    firstExisting(
      cwd,
      ROOTS.flatMap((r) => names.map((n) => (r ? `${r}/${n}` : n))),
      outDir,
    );
  const found: ProjectScan["found"] = {
    manifest: where([manifestPath.replace(/^\//, "")]),
    htaccess: where([".htaccess"]),
    vercelJson: firstExisting(cwd, ["vercel.json"], outDir),
    headers: where(["_headers"]),
    routesJson: where(["_routes.json"]),
  };

  const existing: ExistingFiles = {};
  for (const [key, rel] of Object.entries(found) as [keyof ExistingFiles, string | undefined][]) {
    if (rel) existing[key] = readFileSync(resolve(cwd, rel), "utf8");
  }
  return { files, existing, found };
}

/** True when `rel` (from `relative(base, target)`) leaves `base`: up a level, or a different drive on Windows. */
const escapes = (rel: string) => isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep);

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Where `abs` really is on disk: symlinks resolved for the part that exists, the rest (not created yet) kept as it is.
 * A dangling symlink is refused, because writing "through" it would create its target wherever it points.
 */
function realLocation(abs: string): string {
  const tail: string[] = [];
  let at = abs;
  for (;;) {
    try {
      lstatSync(at);
      break;
    } catch {
      const up = dirname(at);
      if (up === at) break;
      tail.unshift(basename(at));
      at = up;
    }
  }
  try {
    return join(realpathSync(at), ...tail);
  } catch {
    throw new CliError(`${at} is a symbolic link that points nowhere.`);
  }
}

/**
 * The output directory must be a folder inside the project that we can own: never the project itself or a parent of
 * it, and not a symlink to one, so a typo cannot make `build` write over the project's own files.
 */
export function resolveOutDir(cwd: string, outDir: string): string {
  const abs = resolve(cwd, outDir);
  const rel = relative(cwd, abs);
  const real = relative(realLocation(cwd), realLocation(abs));
  if (rel === "" || escapes(rel) || real === "" || escapes(real)) {
    throw new CliError(
      `outDir "${outDir}" is the project folder itself or outside it (a symbolic link counts). Use a subfolder such as "deeplinker-dist".`,
    );
  }
  return abs;
}

/** Writes one generated file. Refuses anything that would land outside `outDir`, or replace a symbolic link. */
export function writeFile(outDir: string, relPath: string, content: string): void {
  const abs = join(outDir, relPath);
  if (escapes(relative(outDir, abs)) || escapes(relative(realLocation(outDir), realLocation(dirname(abs))))) {
    throw new CliError(`Refusing to write "${relPath}": it would end up outside the output folder.`);
  }
  if (isLink(abs)) throw new CliError(`Refusing to write "${relPath}": it is a symbolic link.`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
