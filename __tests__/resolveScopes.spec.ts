import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveScopes } from "../src/index.js";

let root: string;

const writeManifest = async (dir: string, content: string): Promise<void> => {
  const absolute = path.join(root, dir);

  await mkdir(absolute, { recursive: true });
  await writeFile(path.join(absolute, "package.json"), content, "utf-8");
};

const writePackage = async (dir: string, manifest: Record<string, unknown>): Promise<void> =>
  writeManifest(dir, JSON.stringify(manifest));

const sorted = async (
  packages: readonly string[],
  defaultScopes: "public" | "all",
  extraScopes: readonly string[] = [],
): Promise<string[] | null> => {
  const scopes = await resolveScopes(root, packages, defaultScopes, extraScopes);

  return scopes ? [...scopes].sort() : null;
};

describe("resolveScopes()", () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "verify-commit-message-scopes-"));

    await writePackage(".", { name: "root", private: true });
    await writePackage("packages/alpha", { name: "@x/alpha" });
    await writePackage("packages/beta", { name: "@x/beta", private: true });
    await writePackage("plugins/core/gamma", { name: "@x/gamma" });
    await writePackage("plugins/core/delta", { name: "@x/delta", private: true });
    await writePackage("plugins/extra/epsilon", {});
    await writePackage("plain/simple", { name: "simple-pkg" });
    await writePackage("docs", { name: "@x/docs", private: true });
    await writeManifest("broken/bad", "{ not json");
    await writePackage("node_modules/ignored", { name: "@x/ignored" });
    await writePackage(".hidden/ignored", { name: "@x/hidden" });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("derives scopes from a single-level glob", async () => {
    await expect(sorted(["packages/*"], "public", ["deps"])).resolves.toStrictEqual([
      "alpha",
      "deps",
    ]);
  });

  it("includes private packages when defaultScopes is `all`", async () => {
    await expect(sorted(["packages/*"], "all", ["deps"])).resolves.toStrictEqual([
      "alpha",
      "beta",
      "deps",
    ]);
  });

  it("supports nested globs", async () => {
    await expect(sorted(["plugins/*/*"], "public")).resolves.toStrictEqual(["epsilon", "gamma"]);
  });

  it("supports the `**` glob", async () => {
    await expect(sorted(["plugins/**"], "public")).resolves.toStrictEqual(["epsilon", "gamma"]);
  });

  it("supports `**` in the middle of a pattern", async () => {
    await expect(sorted(["plugins/**/*"], "public")).resolves.toStrictEqual(["epsilon", "gamma"]);
  });

  it("supports a glob whose static prefix is the package itself", async () => {
    await expect(sorted(["docs"], "all")).resolves.toStrictEqual(["docs"]);
  });

  it("supports multiple roots", async () => {
    await expect(sorted(["plugins/*/*", "docs"], "all")).resolves.toStrictEqual([
      "delta",
      "docs",
      "epsilon",
      "gamma",
    ]);
  });

  it("uses the package name without the npm scope", async () => {
    await expect(sorted(["plain/*"], "public")).resolves.toStrictEqual(["simple-pkg"]);
  });

  it("falls back to the directory name when the manifest is unreadable", async () => {
    await expect(sorted(["broken/*"], "public")).resolves.toStrictEqual(["bad"]);
  });

  it("returns null when nothing matches", async () => {
    await expect(sorted(["nonexistent/*"], "public")).resolves.toBeNull();
  });

  it("skips node_modules and dot directories", async () => {
    await expect(sorted(["**"], "public")).resolves.toStrictEqual([
      "alpha",
      "bad",
      "epsilon",
      "gamma",
      "simple-pkg",
    ]);
  });

  it("returns no extra scopes when none are given", async () => {
    await expect(sorted(["packages/*"], "public")).resolves.toStrictEqual(["alpha"]);
  });
});
