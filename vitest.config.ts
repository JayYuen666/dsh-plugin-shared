import { definePackageConfig } from "./config/vitest.base.ts";

// 被测面就是 lib 下全部源码（公共面见 config/vitest.base.ts）。
export default definePackageConfig({
  coverageInclude: ["lib/**/*.ts"],
  // 日志账本：接管 console.*，让算子日志既不漏进报告、又必须被用例认领
  // （见 test/setup-logs.ts）。公共面在 shared/config/vitest.base.ts 单源。
  test: { setupFiles: ["test/setup-logs.ts"] },
});
