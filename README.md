# @mr-hope/verify-commit-message

[![npm](https://img.shields.io/npm/v/@mr-hope/verify-commit-message.svg)](https://www.npmjs.com/package/@mr-hope/verify-commit-message)
[![license](https://img.shields.io/npm/l/@mr-hope/verify-commit-message.svg)](./LICENSE)

Verify conventional commit messages, with error reports written for both humans and AI agents.

Unlike `commitlint`, every failure explains **what was received, what was expected, which values are allowed, and how to fix it** — so an agent can correct the message without reading the source.

## Usage

### As a `commit-msg` hook

```ts
// scripts/verifyCommit.ts
import { verifyCommitMessage } from "@mr-hope/verify-commit-message";

await verifyCommitMessage({ importMeta: import.meta, process });
```

```sh
# .husky/commit-msg
pnpm exec tsx scripts/verifyCommit.ts "$1"
```

### As a CLI

```sh
npx @mr-hope/verify-commit-message .git/COMMIT_EDITMSG
```

When no path is given, `.git/COMMIT_EDITMSG` of the detected project root is used.

### As a library

```ts
import { verifySubject } from "@mr-hope/verify-commit-message";

const problems = verifySubject("fix(plugin-attrs): correct parsing", {
  scopes: ["plugin-attrs", "deps"],
});

if (problems.length > 0) console.error(problems);
```

## API

### `verifyCommitMessage(options)`

End-to-end verification: locates the project root, derives the allowed scopes, reads the commit message file, validates the subject line, and exits with code `1` after printing a report when the message is invalid.

| Option             | Type                | Default          | Description                                                                                                             |
| ------------------ | ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `process`          | `ProcessLike`       | —                | The caller's `process`, used to read `argv` and to exit.                                                                |
| `importMeta`       | `ImportMeta`        | —                | The caller's `import.meta`, used to locate the project root. Falls back to `process.cwd()`.                             |
| `types`            | `readonly string[]` | 13 conventional  | Allowed commit types.                                                                                                   |
| `scopes`           | `readonly string[]` | derived          | Allowed commit scopes. When given, it **replaces** the derived scopes entirely.                                         |
| `packages`         | `readonly string[]` | `["packages/*"]` | Glob patterns matching package directories. A directory counts as a package when it directly contains a `package.json`. |
| `defaultScopes`    | `"public" \| "all"` | `"public"`       | `"public"` only counts packages that are not marked `private`; `"all"` counts every match.                              |
| `extraScopes`      | `readonly string[]` | `["deps"]`       | Extra scopes always allowed in addition to the derived ones.                                                            |
| `maxSubjectLength` | `number`            | `50`             | Maximum length of the description after `: `.                                                                           |

The commit message file is read from `process.argv[2]`, falling back to `<root>/.git/COMMIT_EDITMSG`.

### `verifySubject(subject, options)`

Validates a single subject line and returns a list of problems. An empty array means the subject is valid.

### `resolveScopes(root, packages, defaultScopes, extraScopes)`

Derives the allowed scopes from the packages of a project. Returns `null` when no pattern matches any package, which means scopes are not allowed at all.

### `printProblems(problems, msgPath, subject, options)`

Prints a report to `stderr`.

## Scope derivation

Scopes are derived from the packages matched by `packages`:

- A directory counts as a package when it **directly contains a `package.json`**, so `dist/` and `node_modules/` are never mistaken for packages.
- `*` matches within one path segment, `**` across segments, and `?` a single character. Multiple roots and arbitrary nesting are supported, e.g. `["packages/*", "plugins/*/*", "theme/*"]`.
- The scope of a package is its name without the npm scope (`@mdit/plugin-attrs` → `plugin-attrs`), falling back to the directory name when the manifest has no `name`.
- When no pattern matches any package, scopes are not allowed at all — which is what a non-monorepo project wants.

## Error report

```text
 ERROR  invalid commit message — 1 problem found
  message file: /path/to/.git/COMMIT_EDITMSG
  subject line: "feature(plugin-attrs): add thing"

  1. unknown commit type "feature".
     • A commit type must be one of: feat, fix, docs, style, refactor, perf, test, workflow, build, ci, chore, types, release
     • Example: fix(plugin-attrs): correct nested token parsing

  Required format: type(scope): subject — subject ≤ 50 characters, ASCII ": " separator.
```

## License

[MIT](./LICENSE) © Mr.Hope
