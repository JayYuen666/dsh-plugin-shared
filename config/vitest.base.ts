// shared/config/vitest.base.ts —— 各包 vitest 配置的单源。
//
// 为什么是 TS 而不是每包一份零 import 的 `.mjs` 纯对象：早年的理由是"vitest 会把配置复制到
// `node_modules/.vite-temp/` 再加载，从那里解析 `vitest` 会被 node_modules 边界截断"。在
// vitest 5.0.2 + Vite 8.3.1 上实测三条都与该理由相反：`.mjs` 里 import `vitest/config` 通过、
// 改名 `.ts` 同样通过、两次运行后 `.vite-temp/` 都是空目录（复制路径没被触发）。那是
// rolldown-vite 早期版本的行为，已经不构成不引依赖的理由。TS 形态的净收益：判据能写理由、
// 能被 `defineConfig` 的类型检查、能把各份配置里逐字相同的公共面收成一份。
// 各包配置从此只留**自己的差异**：覆盖率 `include` 的面、确有必要的逐键覆盖项、
// 以及与覆盖率无关的 test 字段。
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

type TestConfig = NonNullable<PackageConfig["test"]>;
type CoverageConfig = NonNullable<TestConfig["coverage"]>;

/**
 * 覆盖率覆盖项的形状。`include` 不在其中：统计面由 `coverageInclude` 单源供给，两处各写一份
 * 必然漂移。覆盖率对象整块替换会让四项 100% 阈值与排除表静默消失，所以覆盖项不走 `test`
 * 展开，而是逐键合并；`thresholds` 之内也逐键合并，单项可改、其余三项删不掉。
 */
type CoverageOverride = Omit<Partial<CoverageConfig>, "include">;

/** 覆盖率面与 test 块里真正因包而异的那一项。 */
export interface PackageVitestOptions {
  /** `coverage.include` —— 本包该被统计的源文件（各包只有这里不同）；空数组/空串在工厂即抛。 */
  coverageInclude: string[];
  /** 覆盖率覆盖项：逐键合并到公共面。要例外就在这里写，不要在 `test` 里塞 `coverage`。 */
  coverage?: CoverageOverride;
  /** 追加/覆盖 test 字段（少用；出现即应在包内配置里写明为什么）。 */
  test?: PackageConfig["test"];
}

/** 公共覆盖率面；`include` 在工厂里由 `coverageInclude` 填入。 */
const COVERAGE_BASE: CoverageConfig = {
  provider: "v8",
  exclude: [
    // 两套前缀并存：裸前缀按配置所在根匹配，`**/` 前缀兜住嵌套目录里的同名树。
    "test/**",
    "node_modules/**",
    "**/test/**",
    "**/node_modules/**",
    // 消费包的真实非源码树：client 半的构建产物（build-client*.mjs 写 client.js）、
    // dir-prep-organize 的上游数据目录、各包的维护脚本。
    "build-client*",
    "client.js",
    "agents/**",
    "scripts/**",
    // 声明文件没有可执行语句，两种扩展名都挡在统计面外。
    "**/*.d.ts",
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
};

/**
 * 公共面：各份配置里逐字相同的那部分，从今往后只有一处。
 * `testTimeout: 20_000` 是各包共同值（vitest 默认 5000）；继承它只会放宽不会收紧，
 * 故不会把任何已过用例变成不稳定。
 */
export function definePackageConfig(options: PackageVitestOptions): PackageConfig {
  const { coverageInclude, coverage, test } = options;
  // 统计面塌成空集/缺件时四项 100% 阈值照常通过，是假绿灯；vitest 对此不报错，只能在这里拦。
  if (coverageInclude.length === 0 || coverageInclude.some((entry) => entry.trim().length === 0)) {
    throw new Error(
      "coverageInclude 不能为空数组，也不能含空串：统计面缺件后覆盖率阈值照样全绿，缺的是判据不是覆盖。",
    );
  }
  if (test && "coverage" in test) {
    throw new Error(
      "test.coverage 会整块替换公共覆盖率面（含四项 100% 阈值与排除表）；覆盖率覆盖项请走 coverage 参数，逐键合并。",
    );
  }
  return defineConfig({
    test: {
      // 用例形态放宽到 spec 命名与全部 TS 扩展位（.tsx/.mts/.cts）：旧口径只认
      // `test/**/*.test.ts`，其余形态与命名的用例会被静默漏跑，且 vitest 不报错。
      // 目录仍收在 test/ 下——与源码同目录的用例不是本工作区的约定。
      include: ["test/**/*.{test,spec}.{ts,tsx,mts,cts}"],
      environment: "node",
      testTimeout: 20_000,
      coverage: {
        ...COVERAGE_BASE,
        ...coverage,
        include: coverageInclude,
        thresholds: { ...COVERAGE_BASE.thresholds, ...coverage?.thresholds },
      },
      ...test,
    },
  });
}
