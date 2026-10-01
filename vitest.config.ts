import type { ViteUserConfig } from "vitest/config";
import { defineConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
    },
    env: {
      NO_COLOR: "1",
    },
  },
});

export default config;
