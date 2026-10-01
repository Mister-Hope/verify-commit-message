import { afterEach, describe, expect, it, vi } from "vitest";

import { printProblems, verifySubject } from "../src/index.js";

describe("printProblems()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a single problem with the scoped format", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const problems = verifySubject("feature(a): add thing", { scopes: ["a"] });

    printProblems(problems, "/tmp/COMMIT_EDITMSG", "feature(a): add thing", { scopes: ["a"] });

    const output = error.mock.calls.flat().join("\n");

    expect(output).toContain("1 problem found");
    expect(output).toContain("message file: /tmp/COMMIT_EDITMSG");
    expect(output).toContain('subject line: "feature(a): add thing"');
    expect(output).toContain("Required format: type(scope): subject");
  });

  it("pluralises the problem count and falls back to the scope-less format", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const problems = verifySubject("feature(unknown): ");

    printProblems(problems, "/tmp/COMMIT_EDITMSG", "feature(unknown): ");

    const output = error.mock.calls.flat().join("\n");

    expect(output).toContain("3 problems found");
    expect(output).toContain("Required format: type: subject");
  });
});
