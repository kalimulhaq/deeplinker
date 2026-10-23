import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, makeZip } from "../src/zip";
import { asText, readZip } from "./zip-reader";

describe("crc32", () => {
  it("matches the standard check values", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("makeZip", () => {
  const files = [
    { path: "deeplinker-dist/.well-known/assetlinks.json", content: '[{"a":1}]\n' },
    { path: "deeplinker-dist/README-DEPLOY.md", content: "# Déployer ✓\n" },
    { path: "deeplinker-dist/empty.txt", content: "" },
  ];

  it("round-trips names and bytes, in order, including non-ASCII text and an empty file", () => {
    const entries = readZip(makeZip(files));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.path));
    expect(entries.map(asText)).toEqual(files.map((f) => f.content));
  });

  it("is deterministic: the same files always give the same bytes", () => {
    expect(makeZip(files)).toEqual(makeZip(files));
  });

  it("accepts bytes as well as text", () => {
    const [entry] = readZip(makeZip([{ path: "a.bin", content: new Uint8Array([0, 255, 10, 13]) }]));
    expect([...(entry?.data ?? [])]).toEqual([0, 255, 10, 13]);
  });

  it("refuses an entry that would unpack outside its folder", () => {
    expect(() => makeZip([{ path: "../evil", content: "x" }])).toThrow(/outside/);
    expect(() => makeZip([{ path: "a/../../evil", content: "x" }])).toThrow(/outside/);
    expect(() => makeZip([{ path: "/etc/passwd", content: "x" }])).toThrow(/outside/);
  });

  const unzip = spawnSync("unzip", ["-v"]).status === 0;
  it.skipIf(!unzip)("is accepted by unzip, which unpacks the same files", () => {
    const dir = mkdtempSync(join(tmpdir(), "deeplinker-zip-"));
    try {
      writeFileSync(join(dir, "out.zip"), makeZip(files));
      const test = spawnSync("unzip", ["-tq", join(dir, "out.zip")], { encoding: "utf8" });
      expect(test.stdout + test.stderr).toContain("No errors detected");
      const run = spawnSync("unzip", ["-q", join(dir, "out.zip"), "-d", join(dir, "x")], {
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
      expect(readFileSync(join(dir, "x/deeplinker-dist/README-DEPLOY.md"), "utf8")).toBe("# Déployer ✓\n");
      expect(readFileSync(join(dir, "x/deeplinker-dist/.well-known/assetlinks.json"), "utf8")).toBe(
        '[{"a":1}]\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
