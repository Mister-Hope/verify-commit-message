import { defineHopeConfig } from "oxc-config-hope/oxlint";
import type { OxlintConfig } from "oxc-config-hope/oxlint";

const oxlintConfig: OxlintConfig = defineHopeConfig(
  {
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      // Tests need shared fixtures, so setup/teardown hooks are intentional here.
      "vitest/no-hooks": "off",
      "vitest/prefer-hooks-in-order": "off",
      "vitest/require-top-level-describe": "off",
    },
  },
  {
    // This package is a CLI: writing to the console and reading the file system is its whole purpose.
    files: ["src/**"],
    rules: {
      "import/no-nodejs-modules": "off",
      "no-console": "off",
    },
  },
);

export default oxlintConfig;
