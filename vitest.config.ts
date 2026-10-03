import { definePackageConfig } from "./config/vitest.base.ts";

// 本包只有 lib：四个共享模块就是全部被测面（公共面见 shared/config/vitest.base.ts）。
export default definePackageConfig({
  coverageInclude: ["lib/**/*.ts"],
});
