import type { ManifestFragment, RelatedApplication } from "../files/manifest";
import type { Json } from "../types";

export interface ManifestMerge {
  merged: Json;
  /** Fields the user already had with a different value. Their value is kept. */
  conflicts: string[];
  /** Top-level members this merge added or extended. */
  added: string[];
}

const same = (existing: unknown, wanted: RelatedApplication): boolean => {
  if (!existing || typeof existing !== "object") return false;
  const e = existing as RelatedApplication;
  return (
    e.platform === wanted.platform &&
    ((wanted.id !== undefined && e.id === wanted.id) || (wanted.url !== undefined && e.url === wanted.url))
  );
};

/**
 * Adds the deeplinker members to an existing manifest without changing anything the user wrote: new keys go at the
 * end, `related_applications` only gains entries that are not already there, and a scalar the user already set stays
 * as it is (reported as a conflict when it differs). The inputs are not modified.
 */
export function mergeManifest(existing: Json | undefined, fragment: ManifestFragment): ManifestMerge {
  const merged: Json = existing ? JSON.parse(JSON.stringify(existing)) : {};
  const conflicts: string[] = [];
  const added: string[] = [];

  if (fragment.related_applications) {
    const current = merged.related_applications;
    if (current === undefined) {
      merged.related_applications = [...fragment.related_applications];
      added.push("related_applications");
    } else if (!Array.isArray(current)) {
      conflicts.push(
        "related_applications: your manifest has a value that is not an array, so it was left alone.",
      );
    } else {
      const missing = fragment.related_applications.filter((wanted) => !current.some((e) => same(e, wanted)));
      if (missing.length) {
        current.push(...missing);
        added.push("related_applications");
      }
    }
  }

  for (const key of ["prefer_related_applications", "handle_links"] as const) {
    const wanted = fragment[key];
    if (wanted === undefined) continue;
    if (!(key in merged)) {
      merged[key] = wanted;
      added.push(key);
    } else if (merged[key] !== wanted) {
      conflicts.push(
        `${key}: kept your value ${JSON.stringify(merged[key])}; deeplinker would have set ${JSON.stringify(wanted)}.`,
      );
    }
  }

  return { merged, conflicts, added };
}
