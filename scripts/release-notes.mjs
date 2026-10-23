// Checks that a release is ready and writes its notes.
//
//   node scripts/release-notes.mjs v0.1.0 [out-file]
//
// The tag must match the version of @kalimulhaq/deeplinker, and CHANGELOG.md must have a dated section for it
// (`## [0.1.0] - 2026-10-24`, not `- Unreleased`). That section becomes the GitHub Release notes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

const tag = process.argv[2] ?? fail("Pass the tag, for example: node scripts/release-notes.mjs v0.1.0");
const out = process.argv[3];
const version = tag.replace(/^v/, "");
const { version: kit } = JSON.parse(readFileSync(resolve(root, "packages/deeplinker/package.json"), "utf8"));
if (version !== kit) fail(`Tag ${tag} does not match packages/deeplinker/package.json (${kit}).`);

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const escaped = version.replace(/\./g, "\\.");
const section = new RegExp(
  `^## \\[${escaped}\\] - (?<date>.+?)$\\n(?<body>[^]*?)(?=^## \\[|(?![^]))`,
  "m",
).exec(changelog);
if (!section?.groups) fail(`CHANGELOG.md has no "## [${version}]" section.`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(section.groups.date.trim()))
  fail(
    `CHANGELOG.md's section for ${version} is dated "${section.groups.date}"; give it the release date (YYYY-MM-DD).`,
  );
const notes = section.groups.body.trim();
if (!notes) fail(`CHANGELOG.md's section for ${version} is empty.`);

if (out) writeFileSync(out, notes + "\n");
else console.log(notes);
console.error(`Release ${tag} is ready: version and changelog match.`);
