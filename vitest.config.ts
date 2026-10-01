import { definePackageConfig } from "@jayyuen66/dsh-plugin-shared/config/vitest.base";

// 本包只有 lib：四个共享模块就是全部被测面（公共面见 shared/config/vitest.base.ts）。
export default definePackageConfig({
  coverageInclude: ["lib/**/*.ts"],
});
