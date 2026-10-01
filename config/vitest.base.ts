// shared/config/vitest.base.ts —— 13 个包的 vitest 配置单源。
//
// 为什么从"每包一份零 import 的 `.mjs` 纯对象"换成"TS + 共享基模块"：老 README 给出的理由是
// "vitest 会把配置复制到 `node_modules/.vite-temp/` 再加载，从那里解析 `vitest` 会被 node_modules
// 边界截断"。在 vitest 5.0.2 上实测三条，全部与该理由相反：
//   ① `.mjs` 配置里 `import { defineConfig } from "vitest/config"` ⇒ 通过；
//   ② 配置改名 `.ts` 并同样 import ⇒ 通过；
//   ③ 两次运行后 `plugins/node_modules/.vite-temp/` 与 `shared/node_modules/.vite-temp/` 都是空目录
//      （复制路径没有被触发）。
// 也就是说那是 rolldown-vite 早期版本的行为，在 5.0.2 + Vite 8.3.1 上已经不成立。TS 形态的净收益：
// 判据能写理由、能被 `defineConfig` 的类型检查、能把 13 份重复的公共面收成一份（owner 口径：
// 能用 TS 就不用其他格式）。各包配置从此只留**自己的差异**：覆盖率 `include` 的面。
//
// 阈值不在这里放宽：四项 100% 是每包都生效的默认，任何包要例外必须在自己的配置里写明理由。

import { defineConfig } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";

/**
 * 类型名按实测取（四轮才钉准，过程记在这里免得下次再猜）：
 *  - `import type { UserConfig } from "vitest/config"` ⇒ TS2305，5.0.2 不导出这个名字；
 *  - `import type { UserConfig as ViteUserConfig }` 同样 TS2305 —— 它在 `vitest/config` 里的
 *    **导出名就已经是 `ViteUserConfig`**（源上是 `export { UserConfig as ViteUserConfig } from 'vite'`），
 *    别名要写在被导入的那一侧，不能自己再造一遍；
 *  - `Parameters<typeof defineConfig>[0]` ⇒ 合出来是重载联合 `ViteUserConfigExport`（函数类型），
 *    取 `.test` 直接 TS2339，并级联两条 `no-unsafe-*`；
 *  - `TestUserConfig` 是 **test 块本身**的类型，不是配置文件对象类型，
 *    拿它当返回值会在 `exactOptionalPropertyTypes: true` 下报 TS2375。
 * 正确的那个是 `ViteUserConfig`：vitest 用模块声明合并给它加了 `test?: VitestInlineConfig`，
 * 也正是 `defineConfig(config: UserConfig): UserConfig` 那条重载吃的形状。
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
 * 公共面：13 份配置里逐字相同的那部分，从今往后才真的只有一处。
 * `testTimeout: 20_000` 是 12 个包的共同值（vitest 默认 5000），shared 原先没写、
 * 现在继承这个值只会放宽不会收紧，故不会把任何已过用例变成不稳定。
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
