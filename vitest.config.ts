import { definePackageConfig } from "./config/vitest.base.ts";

// 本包只有 lib：四个共享模块就是全部被测面（公共面见 shared/config/vitest.base.ts）。
export default definePackageConfig({
  coverageInclude: ["lib/**/*.ts"],
  // 日志账本：接管 console.*，让算子日志既不漏进报告、又必须被用例认领
  // （见 test/setup-logs.ts）。公共面在 shared/config/vitest.base.ts 单源。
  test: { setupFiles: ["test/setup-logs.ts"] },
});
