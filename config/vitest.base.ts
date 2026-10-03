// shared/config/vitest.base.ts —— 各包 vitest 配置的单源。
//
// 为什么是 TS 而不是每包一份零 import 的 `.mjs` 纯对象：早年的理由是"vitest 会把配置复制到
// `node_modules/.vite-temp/` 再加载，从那里解析 `vitest` 会被 node_modules 边界截断"。在
// vitest 5.0.2 + Vite 8.3.1 上实测三条都与该理由相反：`.mjs` 里 import `vitest/config` 通过、
// 改名 `.ts` 同样通过、两次运行后 `.vite-temp/` 都是空目录（复制路径没被触发）。那是
// rolldown-vite 早期版本的行为，已经不构成不引依赖的理由。TS 形态的净收益：判据能写理由、
// 能被 `defineConfig` 的类型检查、能把各份配置里逐字相同的公共面收成一份。
// 各包配置从此只留**自己的差异**：覆盖率 `include` 的面。
//
// 阈值不在这里放宽：四项 100% 是每包都生效的默认，任何包要例外必须在自己的配置里写明理由。

import { defineConfig } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";

/**
 * 配置文件的返回形状。vitest 用模块声明合并给 `ViteUserConfig` 加了 `test?: VitestInlineConfig`，
 * 而 `defineConfig` 吃的正是这个形状。别的名义都不对：`UserConfig` 在 `vitest/config` 里
 * 就叫 `ViteUserConfig` 导出（再写一次别名等于没引到），`Parameters<typeof defineConfig>[0]`
 * 合出来是重载联合（函数类型，取 `.test` 直接落空），`TestUserConfig` 是 test 块本身的类型。
 */
type PackageConfig = ViteUserConfig;

/** 覆盖率面与 test 块里真正因包而异的那一项。 */
export interface PackageVitestOptions {
  /** `coverage.include` —— 本包该被统计的源文件（各包只有这里不同）。 */
  coverageInclude: string[];
  /** 追加/覆盖 test 字段（少用；出现即应在包内配置里写明为什么）。 */
  test?: PackageConfig["test"];
}

/**
 * 公共面：各份配置里逐字相同的那部分，从今往后只有一处。
 * `testTimeout: 20_000` 是各包共同值（vitest 默认 5000）；继承它只会放宽不会收紧，
 * 故不会把任何已过用例变成不稳定。
 */
export function definePackageConfig(options: PackageVitestOptions): PackageConfig {
  const { coverageInclude, test } = options;
  return defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      environment: "node",
      testTimeout: 20_000,
      coverage: {
        provider: "v8",
        include: coverageInclude,
        exclude: [
          "test/**",
          "node_modules/**",
          "build-client*",
          "client.js",
          "agents/**",
          "scripts/**",
          "**/*.d.mts",
        ],
        reporter: ["text", "json-summary", "json"],
        reportsDirectory: "coverage",
        thresholds: {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
      ...test,
    },
  });
}
