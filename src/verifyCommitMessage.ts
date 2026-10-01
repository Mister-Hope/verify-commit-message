import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import picocolors from "picocolors";

export const DEFAULT_TYPES: readonly string[] = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "workflow",
  "build",
  "ci",
  "chore",
  "types",
  "release",
];

export const DEFAULT_MAX_SUBJECT_LENGTH = 50;

/**
 * Glob patterns (relative to the project root) matching package directories by default.
 *
 * 默认用于匹配包目录的 glob 模式（相对于项目根目录）。
 */
export const DEFAULT_PACKAGES_GLOBS: readonly string[] = ["packages/*"];

/** Extra scopes always allowed in addition to the derived package scopes. */
export const DEFAULT_EXTRA_SCOPES: readonly string[] = ["deps"];

/** Directory names that are never traversed when looking for packages. */
const IGNORED_DIRECTORY_NAMES = new Set(["node_modules"]);

const GLOB_SPECIAL_CHARS_RE = /[.+^${}()|[\]\\]/gu;

// Shape-only match. Length (and emptiness) of the description is validated separately
// so that each failure can report an actionable, specific error.
const COMMIT_RE = /^(?:revert: )?(?<type>[^(]*?)(?:\((?<scope>[^)]*?)\))?!?: (?<description>.*)$/u;

export interface Problem {
  summary: string;
  details: string[];
}

export interface VerifyCommitOptions {
  /**
   * Allowed commit types.
   *
   * 允许的提交类型。
   *
   * @default DEFAULT_TYPES
   */
  types?: readonly string[];
  /**
   * Allowed commit scopes.
   *
   * When provided, `(scope)` becomes part of the expected format and, if present, must be one of
   * these values. When omitted, a scope is not allowed at all (useful for non-monorepo projects).
   *
   * 允许的提交 scope。
   *
   * 传入时 `(scope)` 会成为期望格式的一部分，若出现则必须属于该列表；不传时完全不允许出现 scope（适用于非 monorepo 项目）。
   */
  scopes?: readonly string[];
  /**
   * Maximum length of the description after `: `.
   *
   * `: ` 之后描述的最大长度。
   *
   * @default 50
   */
  maxSubjectLength?: number;
}

/**
 * Minimal structural type of the Node.js `process` object, so this module can be packaged without
 * depending on `@types/node`.
 *
 * Node.js `process` 对象的最小结构类型，使本模块可被打包复用而不依赖 `@types/node`。
 */
export interface ProcessLike {
  /** Command line arguments / 命令行参数 */
  argv: readonly string[];
  /** Current working directory / 当前工作目录 */
  cwd: () => string;
  /** Terminate the process with the given exit code / 以给定退出码结束进程 */
  exit: (code?: number) => never;
}

/** Which matched packages contribute scopes. */
export type DefaultScopes = "public" | "all";

export interface VerifyCommitMessageOptions extends VerifyCommitOptions {
  /**
   * The caller's `import.meta`, used to locate the project root (the nearest directory containing a
   * `package.json`, starting from the caller's directory).
   *
   * When omitted, `process.cwd()` is used instead, which is what a CLI installed in `node_modules`
   * should do.
   *
   * 调用方的 `import.meta`，用于定位项目根目录（从调用方所在目录向上找到最近的含 `package.json` 的目录）。
   *
   * 省略时改用 `process.cwd()`，这正是安装在 `node_modules` 中的 CLI 应有的行为。
   */
  importMeta?: ImportMeta;
  /**
   * The caller's `process`, used to read `argv` and to exit on failure.
   *
   * 调用方的 `process`，用于读取 `argv` 以及在校验失败时退出。
   */
  process: ProcessLike;
  /**
   * Glob patterns (relative to the project root) matching package directories. A directory counts
   * as a package when it directly contains a `package.json`.
   *
   * Supports `*` (within one path segment), `**` (across segments) and `?`. Multiple roots and
   * arbitrary nesting are supported, for example a `plugins` directory whose packages live two
   * levels deep.
   *
   * When no pattern matches any package, scopes are not allowed at all (useful for non-monorepo
   * projects).
   *
   * 相对于项目根目录、用于匹配包目录的 glob 模式。目录直接包含 `package.json` 时才算作包。
   *
   * 支持 `*`（单个路径段内）、`**`（跨路径段）与 `?`。支持多个根目录与任意层级，例如 `plugins` 目录下的包位于两层深处。
   *
   * 当没有任何模式匹配到包时，完全不允许出现 scope（适用于非 monorepo 项目）。
   *
   * @default ["packages/*"]
   */
  packages?: readonly string[];
  /**
   * Which matched packages contribute scopes:
   *
   * - `"public"`: only packages that are not marked `private` (i.e. those that will be published)
   * - `"all"`: every matched package
   *
   * 哪些匹配到的包会贡献 scope：
   *
   * - `"public"`：仅未标记 `private` 的包（即会发布的包）
   * - `"all"`：所有匹配到的包
   *
   * @default "public"
   */
  defaultScopes?: DefaultScopes;
  /**
   * Extra scopes always allowed in addition to the derived package scopes.
   *
   * 除推导出的包 scope 之外额外允许的 scope。
   *
   * @default ["deps"]
   */
  extraScopes?: readonly string[];
}

interface PackageManifest {
  name?: string;
  private?: boolean;
}

const findProjectRoot = (from: string): string => {
  let dir = from;

  while (true) {
    if (existsSync(path.join(dir, "package.json"))) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) return from;

    dir = parent;
  }
};

/**
 * Convert a glob pattern into a regular expression matching POSIX-style relative paths.
 *
 * 把 glob 模式转换为匹配 POSIX 风格相对路径的正则表达式。
 *
 * @param glob - The glob pattern / glob 模式
 * @returns A regular expression anchored to the whole path / 锚定整条路径的正则表达式
 */
const globToRegExp = (glob: string): RegExp => {
  const segments = glob.split("/").filter((segment) => segment !== "");
  let source = "^";

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;

    if (segment === "**") {
      // `**` matches zero or more path segments; as the last segment it must match at least one.
      source += isLast ? "(?:[^/]+/)*[^/]+" : "(?:[^/]+/)*";
    } else {
      source += segment
        .replace(GLOB_SPECIAL_CHARS_RE, String.raw`\$&`)
        .replaceAll("*", "[^/]*")
        .replaceAll("?", "[^/]");

      if (!isLast) source += "/";
    }
  }

  return new RegExp(`${source}$`, "u");
};

/**
 * The leading, wildcard-free part of a glob, used to limit directory traversal.
 *
 * Glob 中开头不含通配符的部分，用于限制目录遍历范围。
 *
 * @param glob - The glob pattern / glob 模式
 * @returns The static prefix, possibly empty / 静态前缀，可能为空字符串
 */
const getStaticPrefix = (glob: string): string => {
  const staticSegments: string[] = [];

  for (const segment of glob.split("/").filter((item) => item !== "")) {
    if (segment.includes("*") || segment.includes("?")) break;
    staticSegments.push(segment);
  }

  return staticSegments.join("/");
};

const collectPackageDirectories = async (
  dir: string,
  base: string,
  result: string[],
): Promise<void> => {
  // The starting directory itself may be the package (e.g. the glob `docs`).
  if (existsSync(path.join(dir, "package.json")))
    result.push(path.relative(base, dir).split(path.sep).join("/"));

  const entries = await readdir(dir, { withFileTypes: true });
  const children: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;

    children.push(path.join(dir, entry.name));
  }

  await Promise.all(children.map((child) => collectPackageDirectories(child, base, result)));
};

/**
 * Find every package directory (a directory directly containing a `package.json`) matching the
 * given globs.
 *
 * 找出所有匹配给定 glob 的包目录（直接包含 `package.json` 的目录）。
 *
 * @param root - The project root / 项目根目录
 * @param globs - Glob patterns relative to the root / 相对于根目录的 glob 模式
 * @returns POSIX-style paths relative to the root / 相对于根目录的 POSIX 风格路径
 */
const findPackageDirectories = async (
  root: string,
  globs: readonly string[],
): Promise<string[]> => {
  const matchers = globs.map((glob) => globToRegExp(glob));
  const found = new Set<string>();

  const collected = await Promise.all(
    [...new Set(globs.map((glob) => getStaticPrefix(glob)))].map(async (prefix) => {
      const start = path.join(root, prefix);
      if (!existsSync(start)) return [];

      const directories: string[] = [];
      await collectPackageDirectories(start, root, directories);
      return directories;
    }),
  );

  for (const directory of collected.flat())
    if (matchers.some((matcher) => matcher.test(directory))) found.add(directory);

  return [...found];
};

const readPackageManifest = async (dir: string): Promise<PackageManifest> => {
  try {
    return JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8")) as PackageManifest;
  } catch {
    // A malformed or unreadable manifest simply contributes no metadata.
    return {};
  }
};

/**
 * Derive the commit scope of a package: its name without the npm scope, or its directory name.
 *
 * 推导包的提交 scope：包名去掉 npm scope，或退化为目录名。
 *
 * @param directory - The package directory (relative to the root) / 包目录（相对于根目录）
 * @param manifest - The package manifest / 包的 package.json 内容
 * @returns The commit scope / 提交 scope
 */
const getScopeName = (directory: string, manifest: PackageManifest): string => {
  const { name } = manifest;

  if (typeof name === "string" && name !== "") {
    const slashIndex = name.lastIndexOf("/");
    return slashIndex === -1 ? name : name.slice(slashIndex + 1);
  }

  return path.basename(directory);
};

/**
 * Validate a single commit subject line against the given options.
 *
 * 根据给定选项校验单行提交主题。
 *
 * @param subject - The subject line (first line of the commit message) / 提交主题（提交信息首行）
 * @param options - Validation options / 校验选项
 * @returns A list of problems, an empty array means the subject is valid / 问题列表，空数组表示合法
 */
export const verifySubject = (subject: string, options: VerifyCommitOptions = {}): Problem[] => {
  const { types = DEFAULT_TYPES, scopes, maxSubjectLength = DEFAULT_MAX_SUBJECT_LENGTH } = options;

  const allowsScope = Boolean(scopes);
  const format = allowsScope ? "type(scope): subject" : "type: subject";
  const example = allowsScope
    ? "fix(plugin-attrs): correct nested token parsing"
    : "fix: correct nested token parsing";
  const problems: Problem[] = [];

  if (subject === "") {
    return [
      {
        summary: "the commit message is empty.",
        details: [
          `A subject line is required, in the form \`${format}\`.`,
          `Example: ${picocolors.green(example)}`,
        ],
      },
    ];
  }

  const match = COMMIT_RE.exec(subject);

  if (!match) {
    return [
      {
        summary: "the subject line does not match the required format.",
        details: [
          `Expected format: ${picocolors.bold(format)}`,
          "The type (and scope) must be followed by an ASCII colon and exactly one ASCII space (`: `).",
          "A full-width colon (`：`) or a missing space after `:` are both invalid.",
          allowsScope
            ? "A `!` may be placed before the colon to mark a breaking change, e.g. `feat(plugin-x)!: ...`."
            : "A `!` may be placed before the colon to mark a breaking change, e.g. `feat!: ...`.",
          `Example: ${picocolors.green(example)}`,
        ],
      },
    ];
  }

  // The regex always produces these groups when it matches; `scope` is absent when no `(...)` is present.
  const { type, scope, description } = match.groups as {
    type: string;
    scope: string | undefined;
    description: string;
  };

  if (!types.includes(type)) {
    problems.push({
      summary: `unknown commit type ${picocolors.cyan(JSON.stringify(type))}.`,
      details: [
        `A commit type must be one of: ${types.map((name) => picocolors.green(name)).join(", ")}`,
        `Example: ${picocolors.green(example)}`,
      ],
    });
  }

  if (typeof scope === "string") {
    if (scopes) {
      if (!scopes.includes(scope)) {
        problems.push({
          summary: `unknown commit scope ${picocolors.cyan(JSON.stringify(scope))}.`,
          details: [
            "A scope must be one of the allowed scopes listed below.",
            "Omit the scope entirely when the change is not tied to a single package, e.g. `chore: ...`.",
            `Allowed scopes: ${scopes.map((name) => picocolors.green(name)).join(", ")}`,
          ],
        });
      }
    } else {
      problems.push({
        summary: `unexpected commit scope ${picocolors.cyan(JSON.stringify(scope))}.`,
        details: [
          "This project does not use commit scopes; omit the `(...)` part entirely.",
          `Write \`${type || "type"}: ${description || "subject"}\` instead.`,
          `Example: ${picocolors.green(example)}`,
        ],
      });
    }
  }

  if (description.length === 0) {
    problems.push({
      summary: "the subject description is empty.",
      details: [
        `There must be between 1 and ${maxSubjectLength} characters after \`: \`.`,
        `Example: ${picocolors.green(example)}`,
      ],
    });
  } else if (description.length > maxSubjectLength) {
    problems.push({
      summary: `the subject description is too long (${description.length} > ${maxSubjectLength} characters).`,
      details: [
        `The text after \`: \` must be at most ${maxSubjectLength} characters.`,
        `Received description (${description.length} characters): ${picocolors.cyan(
          JSON.stringify(description),
        )}`,
        "Shorten the description; keep the type and scope intact.",
        `Example: ${picocolors.green(example)}`,
      ],
    });
  }

  return problems;
};

/**
 * Print the problems of an invalid commit message to stderr in an actionable, agent-friendly
 * format.
 *
 * 以面向 Agent、可直接照做的格式把非法提交信息的问题打印到 stderr。
 *
 * @param problems - Problems returned by `verifySubject` / `verifySubject` 返回的问题列表
 * @param msgPath - Path of the commit message file / 提交信息文件路径
 * @param subject - The validated subject line / 被校验的主题行
 * @param options - The options used for validation / 校验时使用的选项
 */
export const printProblems = (
  problems: Problem[],
  msgPath: string,
  subject: string,
  options: VerifyCommitOptions = {},
): void => {
  const indent = "  ";
  const format = options.scopes ? "type(scope): subject" : "type: subject";
  const maxSubjectLength = options.maxSubjectLength ?? DEFAULT_MAX_SUBJECT_LENGTH;

  console.error("");
  console.error(
    `${picocolors.white(picocolors.bgRed(" ERROR "))} ${picocolors.bold(
      picocolors.red(
        `invalid commit message — ${problems.length} problem${problems.length > 1 ? "s" : ""} found`,
      ),
    )}`,
  );
  console.error(`${indent}${picocolors.dim("message file:")} ${msgPath}`);
  console.error(
    `${indent}${picocolors.dim("subject line:")} ${picocolors.cyan(JSON.stringify(subject))}`,
  );
  console.error("");

  for (const [index, problem] of problems.entries()) {
    console.error(`${indent}${index + 1}. ${picocolors.red(problem.summary)}`);

    for (const detail of problem.details)
      console.error(`${indent}   ${picocolors.dim("•")} ${detail}`);

    console.error("");
  }

  console.error(
    `${indent}${picocolors.dim(
      `Required format: ${format} — subject ≤ ${maxSubjectLength} characters, ASCII ": " separator.`,
    )}`,
  );
  console.error("");
};

/**
 * Derive the allowed scopes from the packages of the project.
 *
 * 从项目的各包推导出允许的 scope。
 *
 * @param root - The project root / 项目根目录
 * @param packages - Glob patterns matching package directories / 匹配包目录的 glob 模式
 * @param defaultScopes - Which packages contribute scopes / 哪些包会贡献 scope
 * @param extraScopes - Extra scopes always allowed / 额外始终允许的 scope
 * @returns The allowed scopes, or `null` when the project has no matching package / 允许的 scope；
 *   项目没有匹配到包时返回 `null`
 */
export const resolveScopes = async (
  root: string,
  packages: readonly string[],
  defaultScopes: DefaultScopes,
  extraScopes: readonly string[],
): Promise<readonly string[] | null> => {
  const directories = await findPackageDirectories(root, packages);
  const names = new Set<string>();

  if (directories.length > 0) {
    const entries = await Promise.all(
      directories.map(async (directory) => ({
        directory,
        manifest: await readPackageManifest(path.join(root, directory)),
      })),
    );

    for (const { directory, manifest } of entries) {
      if (defaultScopes === "public" && manifest.private === true) continue;
      names.add(getScopeName(directory, manifest));
    }
  }

  return directories.length > 0 ? [...names, ...extraScopes] : null;
};

/**
 * Verify the commit message of the current commit, end to end.
 *
 * It locates the project root from `importMeta`, derives the allowed scopes from the packages
 * matched by `packages` (unless `scopes` is given explicitly, which overrides the derivation),
 * reads the commit message file (from `process.argv[2]`, falling back to `.git/COMMIT_EDITMSG`),
 * validates the subject line, and exits with code `1` after printing an actionable report when the
 * message is invalid.
 *
 * 端到端校验当前提交的提交信息。
 *
 * 它会依据 `importMeta` 定位项目根目录、从 `packages` 匹配到的包推导允许的 scope（若显式传入 `scopes` 则直接覆盖推导结果）、读取提交信息文件（取自
 * `process.argv[2]`，缺省为 `.git/COMMIT_EDITMSG`）、校验主题行，并在不合法时打印可照做的报告后以退出码 `1` 结束。
 *
 * @param options - Verification options / 校验选项
 */
export const verifyCommitMessage = async (options: VerifyCommitMessageOptions): Promise<void> => {
  const {
    importMeta,
    process,
    types,
    scopes: scopesOption,
    packages = DEFAULT_PACKAGES_GLOBS,
    defaultScopes = "public",
    extraScopes = DEFAULT_EXTRA_SCOPES,
    maxSubjectLength,
  } = options;

  const root = findProjectRoot(importMeta?.dirname ?? process.cwd());
  const verifyOptions: VerifyCommitOptions = { types, maxSubjectLength };

  if (scopesOption) {
    verifyOptions.scopes = scopesOption;
  } else {
    const scopes = await resolveScopes(root, packages, defaultScopes, extraScopes);
    if (scopes) verifyOptions.scopes = scopes;
  }

  const msgPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(root, ".git/COMMIT_EDITMSG");
  const msg = await readFile(msgPath, "utf-8");
  // Only the first line (subject) is validated; the body may be any format.
  const subject = msg.trim().split("\n", 1)[0].trim();

  const problems = verifySubject(subject, verifyOptions);

  if (problems.length > 0) {
    printProblems(problems, msgPath, subject, verifyOptions);

    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
};
