import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { verifyCommitMessage } from "../src/index.js";

interface FakeProcess {
  argv: string[];
  cwd: () => string;
  exit: (code?: number) => never;
  exitCodes: number[];
}

let bareRoot: string, root: string;

// Build a fake `process` whose `argv` mimics `node script <messageFile>`.
const createProcess = (messageFile: string | null, cwd: string): FakeProcess => {
  const exitCodes: number[] = [];

  return {
    argv: messageFile ? ["node", "script", messageFile] : ["node", "script"],
    cwd: () => cwd,
    exit: (code?: number): never => {
      exitCodes.push(code ?? 0);
      throw new Error(`process.exit(${code})`);
    },
    exitCodes,
  };
};

const writeManifest = async (dir: string, manifest: Record<string, unknown>): Promise<void> => {
  const absolute = path.join(root, dir);

  await mkdir(absolute, { recursive: true });
  await writeFile(path.join(absolute, "package.json"), JSON.stringify(manifest), "utf-8");
};

const writeMessage = async (content: string): Promise<string> => {
  const file = path.join(root, "message.txt");

  await writeFile(file, content, "utf-8");
  return file;
};

describe("verifyCommitMessage()", () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "verify-commit-message-cli-"));
    bareRoot = await mkdtemp(path.join(tmpdir(), "verify-commit-message-bare-"));

    await writeManifest(".", { name: "root", private: true });
    await writeManifest("packages/alpha", { name: "@x/alpha" });
    await writeManifest("packages/beta", { name: "@x/beta", private: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(bareRoot, { recursive: true, force: true });
  });

  it("accepts a valid message without exiting", async () => {
    const file = await writeMessage("fix(alpha): correct thing\n\nSome body.\n");
    const process = createProcess(file, root);

    await verifyCommitMessage({ process });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("exits with code 1 and prints a report for an invalid message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = await writeMessage("feature(alpha): add thing");
    const process = createProcess(file, root);

    await expect(verifyCommitMessage({ process })).rejects.toThrow("process.exit(1)");

    expect(process.exitCodes).toStrictEqual([1]);

    const output = error.mock.calls.flat().join("\n");

    expect(output).toContain("invalid commit message");
    expect(output).toContain('unknown commit type "feature"');
    expect(output).toContain("Required format: type(scope): subject");
  });

  it("reads .git/COMMIT_EDITMSG when no path is given", async () => {
    await writeFile(path.join(root, ".git/COMMIT_EDITMSG"), "fix(alpha): correct thing", "utf-8");

    const process = createProcess(null, root);

    await verifyCommitMessage({ process });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("locates the project root from importMeta", async () => {
    const file = await writeMessage("fix(alpha): correct thing");
    const process = createProcess(file, tmpdir());
    const importMeta = { dirname: path.join(root, "scripts") } as unknown as ImportMeta;

    await verifyCommitMessage({ importMeta, process });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("walks up from a nested working directory", async () => {
    const file = await writeMessage("fix(alpha): correct thing");
    const process = createProcess(file, path.join(root, "packages"));

    await verifyCommitMessage({ process });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("stops at the nearest package.json when the working directory is a package", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = await writeMessage("fix(alpha): correct thing");
    const process = createProcess(file, path.join(root, "packages/alpha"));

    await expect(verifyCommitMessage({ process })).rejects.toThrow("process.exit(1)");

    expect(error.mock.calls.flat().join("\n")).toContain('unexpected commit scope "alpha"');
  });

  it("falls back to the starting directory when no package.json is found", async () => {
    const file = path.join(bareRoot, "message.txt");

    await writeFile(file, "fix: correct thing", "utf-8");

    const process = createProcess(file, bareRoot);

    await verifyCommitMessage({ process });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("rejects a private package scope by default", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = await writeMessage("fix(beta): correct thing");
    const process = createProcess(file, root);

    await expect(verifyCommitMessage({ process })).rejects.toThrow("process.exit(1)");

    expect(error.mock.calls.flat().join("\n")).toContain('unknown commit scope "beta"');
  });

  it("accepts a private package scope with defaultScopes `all`", async () => {
    const file = await writeMessage("fix(beta): correct thing");
    const process = createProcess(file, root);

    await verifyCommitMessage({ process, defaultScopes: "all" });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("lets explicit scopes override the derivation", async () => {
    const file = await writeMessage("fix(custom): correct thing");
    const process = createProcess(file, root);

    await verifyCommitMessage({ process, scopes: ["custom"] });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("lets explicit types override the defaults", async () => {
    const file = await writeMessage("custom(alpha): do something");
    const process = createProcess(file, root);

    await verifyCommitMessage({ process, types: ["custom"] });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("allows no scope at all when no package matches", async () => {
    const file = await writeMessage("fix: correct thing");
    const process = createProcess(file, root);

    await verifyCommitMessage({ process, packages: ["nonexistent/*"] });

    expect(process.exitCodes).toStrictEqual([]);
  });

  it("rejects any scope when no package matches", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = await writeMessage("fix(alpha): correct thing");
    const process = createProcess(file, root);

    await expect(verifyCommitMessage({ process, packages: ["nonexistent/*"] })).rejects.toThrow(
      "process.exit(1)",
    );

    expect(error.mock.calls.flat().join("\n")).toContain('unexpected commit scope "alpha"');
  });

  it("honours a custom maximum subject length", async () => {
    const file = await writeMessage(`fix(alpha): ${"a".repeat(80)}`);
    const process = createProcess(file, root);

    await verifyCommitMessage({ process, maxSubjectLength: 80 });

    expect(process.exitCodes).toStrictEqual([]);
  });
});
