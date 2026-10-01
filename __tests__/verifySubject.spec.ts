import { describe, expect, it } from "vitest";

import { verifySubject } from "../src/index.js";

const summaries = (subject: string, options?: Parameters<typeof verifySubject>[1]): string[] =>
  verifySubject(subject, options).map((problem) => problem.summary);

const detailsOf = (subject: string, options?: Parameters<typeof verifySubject>[1]): string =>
  verifySubject(subject, options)
    .flatMap((problem) => problem.details)
    .join("\n");

describe("verifySubject()", () => {
  describe("valid subjects", () => {
    it("accepts a subject without a scope", () => {
      expect(verifySubject("fix: correct nested token parsing")).toStrictEqual([]);
    });

    it("accepts a subject with an allowed scope", () => {
      expect(
        verifySubject("fix(plugin-attrs): correct parsing", { scopes: ["plugin-attrs"] }),
      ).toStrictEqual([]);
    });

    it("accepts a breaking change marker", () => {
      expect(verifySubject("feat!: drop node 18")).toStrictEqual([]);
      expect(
        verifySubject("feat(plugin-x)!: drop node 18", { scopes: ["plugin-x"] }),
      ).toStrictEqual([]);
    });

    it("accepts a revert subject", () => {
      expect(verifySubject("revert: feat: add thing")).toStrictEqual([]);
    });

    it("accepts a description of exactly the maximum length", () => {
      expect(verifySubject(`fix: ${"a".repeat(50)}`)).toStrictEqual([]);
    });

    it("accepts custom types", () => {
      expect(verifySubject("custom: do something", { types: ["custom"] })).toStrictEqual([]);
    });

    it("accepts a custom maximum length", () => {
      expect(verifySubject(`fix: ${"a".repeat(80)}`, { maxSubjectLength: 80 })).toStrictEqual([]);
    });
  });

  describe("empty subject", () => {
    it("reports an empty commit message", () => {
      expect(summaries("")).toStrictEqual(["the commit message is empty."]);
    });

    it("suggests the scope-less format when scopes are not allowed", () => {
      expect(detailsOf("")).toContain("type: subject");
    });

    it("suggests the scoped format when scopes are allowed", () => {
      expect(detailsOf("", { scopes: ["a"] })).toContain("type(scope): subject");
    });
  });

  describe("malformed subject", () => {
    it("reports a missing separator", () => {
      expect(summaries("fix correct nested parsing")).toStrictEqual([
        "the subject line does not match the required format.",
      ]);
    });

    it("reports a full-width colon", () => {
      expect(summaries("fix： correct parsing")).toStrictEqual([
        "the subject line does not match the required format.",
      ]);
    });

    it("reports a missing space after the colon", () => {
      expect(summaries("fix:correct parsing")).toStrictEqual([
        "the subject line does not match the required format.",
      ]);
    });

    it("mentions the breaking change marker for scoped projects", () => {
      expect(detailsOf("fix correct", { scopes: ["a"] })).toContain("feat(plugin-x)!:");
    });

    it("mentions the breaking change marker for scope-less projects", () => {
      expect(detailsOf("fix correct")).toContain("feat!:");
    });
  });

  describe("unknown type", () => {
    it("reports the unknown type and lists the allowed ones", () => {
      expect(summaries("feature: add thing")).toStrictEqual(['unknown commit type "feature".']);
      expect(detailsOf("feature: add thing")).toContain("feat, fix, docs");
    });

    it("reports an empty type", () => {
      expect(summaries("(plugin-attrs): add thing", { scopes: ["plugin-attrs"] })).toContain(
        'unknown commit type "".',
      );
    });
  });

  describe("scope handling", () => {
    it("reports an unknown scope and lists the allowed ones", () => {
      const options = { scopes: ["plugin-attrs", "deps"] };

      expect(summaries("fix(plugin-atrs): correct thing", options)).toContain(
        'unknown commit scope "plugin-atrs".',
      );
      expect(detailsOf("fix(plugin-atrs): correct thing", options)).toContain("plugin-attrs, deps");
    });

    it("reports an unexpected scope when the project allows none", () => {
      expect(summaries("fix(plugin-attrs): correct thing")).toContain(
        'unexpected commit scope "plugin-attrs".',
      );
      expect(detailsOf("fix(plugin-attrs): correct thing")).toContain(
        "Write `fix: correct thing` instead.",
      );
    });

    it("falls back to placeholder text when the type and description are empty", () => {
      const scopeProblem = verifySubject("(): ").find((problem) =>
        problem.summary.includes("commit scope"),
      );

      expect(scopeProblem?.details.join("\n")).toContain("Write `type: subject` instead.");
    });

    it("reports an empty scope as unknown", () => {
      expect(summaries("fix(): correct thing", { scopes: ["a"] })).toContain(
        'unknown commit scope "".',
      );
    });
  });

  describe("description", () => {
    it("reports an empty description", () => {
      expect(summaries("fix: ")).toStrictEqual(["the subject description is empty."]);
    });

    it("reports a too long description with its length", () => {
      expect(summaries(`fix: ${"a".repeat(60)}`)).toStrictEqual([
        "the subject description is too long (60 > 50 characters).",
      ]);
      expect(detailsOf(`fix: ${"a".repeat(60)}`)).toContain("Received description (60 characters)");
    });
  });

  describe("multiple problems", () => {
    it("reports every problem at once", () => {
      expect(summaries("feature(unknown): ", { scopes: ["a"] })).toStrictEqual([
        'unknown commit type "feature".',
        'unknown commit scope "unknown".',
        "the subject description is empty.",
      ]);
    });
  });
});
