import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: {
    index: "./src/index.ts",
    cli: "./src/cli.ts",
  },
  fixedExtension: false,
  platform: "node",
  minify: true,
  publint: true,
  dts: true,
});

export default config;
