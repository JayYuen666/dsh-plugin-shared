// shared/config/vitest.base.ts —— 各包 vitest 配置的唯一来源。
//
// 为什么是 TS 而不是每包一份零 import 的 `.mjs` 纯对象：早年的理由是"vitest 会把配置复制到
// `node_modules/.vite-temp/` 再加载，从那里解析 `vitest` 会被 node_modules 边界截断"。近版
// （vitest 5.1.1 + Vite 8.3.8）实测三条都与该理由相反：`.mjs` 里 import `vitest/config` 通过、
// 改名 `.ts` 同样通过。TS 形态的净收益：判断能写理由、能被 `defineConfig` 的类型检查、能把
// 各份配置里逐字相同的公共部分收成一份。各包配置从此只留**自己的差异**：覆盖率 `include` 的
// 范围、确有必要的逐键覆盖项、以及与覆盖率无关的 test 字段。
//
// 阈值不在这里放宽：四项 100% 是每包都生效的默认，任何包要例外必须在自己的配置里写明理由。
//
// 三条承重约束，改动前先读对应段落：
//  1. 覆盖率统计范围必须真有测量对象 —— 空集下四项 100% 照常通过，vitest 不报错（见
//     `assertCoverageIncludeMatches`）。
//  2. 覆盖项里 `undefined` 表示"继承"，不是"清空" —— 覆盖发生在逐键合并处，运行期过滤（见
//     `inheritUndefined`）。
//  3. `test.server.deps.inline` 只增不减 —— 它决定 `vi.mock("react")` 能否作用到共享组件
//     （见 `mergeTest`）。

import { glob } from "node:fs/promises";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import type { Plugin, ViteUserConfig } from "vitest/config";

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
 * 覆盖率覆盖项的形状。`include` 不在其中：统计范围由 `coverageInclude` 单独供给，两处各写一份
 * 必然漂移。覆盖率对象整块替换会让四项 100% 阈值与排除表静默消失，所以覆盖项不走 `test`
 * 展开，而是逐键合并；`thresholds` 之内也逐键合并，单项可改、其余三项删不掉。
 */
type CoverageOverride = Omit<Partial<CoverageConfig>, "include">;

/**
 * `test` 覆盖项：类型面不允许 `coverage`。
 * 运行期另有 `Object.hasOwn` 一道（JS 调用方与断言构造出来的对象兜底）：`test.coverage`
 * 会整块替换公共覆盖率配置，包括四项 100% 阈值与排除表。
 */
type TestOverride = Omit<TestConfig, "coverage"> & { coverage?: never };

/** 公共覆盖率配置；`include` 在工厂里由 `coverageInclude` 填入。 */
const COVERAGE_BASE: CoverageConfig = {
  provider: "v8",
  exclude: [
    // 两套前缀并存：不带 `**/` 的前缀按配置所在根匹配，`**/` 前缀覆盖嵌套目录里的同名树。
    "test/**",
    "node_modules/**",
    "**/test/**",
    "**/node_modules/**",
    // 消费包的真实非源码树：客户端构建产物（build-client*.mjs 写 client.js）、
    // dir-prep-organize 的上游数据目录、各包的维护脚本。
    "build-client*",
    "client.js",
    "agents/**",
    "scripts/**",
    // 声明文件没有可执行语句，两种扩展名都挡在统计范围外。
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

/** 共享包必须内联：外部化时它的 `import "react"` 交给 Node 加载器，绕开 dedupe 与 `vi.mock`。 */
const SHARED_INLINE = /@jayyuen66\/dsh-plugin-shared/u;

/** 客户端行的 Node 测试入口：`./client` 的 `node` 条件指向它，发布包里没有源码入口。 */
const CLIENT_NODE_ENTRY = createRequire(import.meta.url).resolve(
  "@jayyuen66/dsh-plugin-shared/client",
);

/** 公共 test 块；`include` 放宽到 spec 命名与全部 TS 扩展位，见下方原注释。 */
const TEST_BASE: TestConfig = {
  // 用例形态放宽到 spec 命名与全部 TS 扩展位（.tsx/.mts/.cts）：旧规则只认
  // `test/**/*.test.ts`，其余形态与命名的用例会被静默漏跑，且 vitest 不报错。
  // 目录仍收在 test/ 下——与源码同目录的用例不是本工作区的约定。
  include: ["test/**/*.{test,spec}.{ts,tsx,mts,cts}"],
  environment: "node",
  testTimeout: 20_000,
  // node_modules 下的包默认被外部化，交给 Node 加载器：它按产物自己的位置解析
  // `import "react"`，绕开 dedupe 与 vi.mock。把 shared 内联进 Vite 流水线，
  // dist 里的 react 导入才走同一套解析，mock 才作用在同一个模块实例上。
  server: { deps: { inline: [SHARED_INLINE] } },
};

/** 公共覆盖率配置与 test 块里真正因包而异的那一项。 */
export interface PackageVitestOptions {
  /** `coverage.include` —— 本包该被统计的源文件（各包只有这里不同）；空数组/空串在工厂即抛。 */
  coverageInclude: string[];
  /** 覆盖率覆盖项：逐键合并到公共配置。要例外就在这里写，不要在 `test` 里塞 `coverage`。 */
  coverage?: CoverageOverride;
  /**
   * 追加/覆盖 test 字段（少用；出现即应在包内配置里写明为什么）。
   * `server.deps.inline` 例外：它只会被追加，不会被替换。
   */
  test?: TestOverride;
}

/**
 * 只保留值不为 `undefined` 的键：覆盖项里的 `undefined` 表示"继承"，不是"清空"。
 *
 * 为什么运行期还要过滤：`exactOptionalPropertyTypes` 只挡得住字面量；JS 调用方、经断言或
 * 外部数据构造出来的对象仍可能带着 `undefined` 属性。`thresholds: { lines: undefined }`
 * 合并后会被 vitest 当成"这一项没有阈值"直接跳过（`threshold === void 0` 即 continue），
 * 于是 66.66% 的行覆盖也能 exit 0；`exclude: undefined` 则会在启动期炸成
 * `resolved.coverage.exclude is not iterable`。两者都是"缺件看起来像通过"的同一类。
 *
 * @param value - 覆盖项；`undefined` 时返回空对象
 * @returns 去掉 `undefined` 值之后的浅拷贝
 */
function inheritUndefined<Value extends object>(value: Value | undefined): Partial<Value> {
  const inherited: Partial<Value> = { ...value };
  for (const key of Object.keys(inherited)) {
    if (Reflect.get(inherited, key) === undefined) {
      Reflect.deleteProperty(inherited, key);
    }
  }
  return inherited;
}

/**
 * 合并 test 覆盖项。普通字段按调用方覆盖；`server.deps.inline` 特殊——它只增不减。
 *
 * 为什么必须保护 inline：`{ ...TEST_BASE, ...override }` 是键级展开，调用方只要写
 * `test.server`（哪怕只是加一条 fs 规则），整个 `deps` 都会被换掉，共享包退回 Node 加载器，
 * 它的 `require("react")` 绕过 `vi.mock("react")`，症状是卡片用例拿到真实 React 的 hook。
 * 一个决定 mock 语义的键不该能被"顺带"覆盖掉，所以这里把基线的 inline 追加回去，
 * 允许调用方只加自己的模式，不允许删掉共享包那一条。
 *
 * @param override - 已经过 `inheritUndefined` 的 test 覆盖项
 * @returns 合并后的 test 块
 */
function mergeTest(override: TestConfig | undefined): TestConfig {
  if (override === undefined) {
    return TEST_BASE;
  }
  const merged: TestConfig = { ...TEST_BASE, ...override };
  if (override.server !== undefined) {
    const ownInline = override.server.deps?.inline;
    // `true` 是"全部内联"，比基线名单更强，原样保留；数组则只许追加，不许删掉共享包那条。
    const inline = ownInline === true ? true : [SHARED_INLINE, ...(ownInline ?? [])];
    merged.server = {
      ...override.server,
      deps: { ...override.server.deps, inline },
    };
  }
  return merged;
}

/**
 * 断言 `coverageInclude` 的每个模式都能在测试根下命中至少一个文件（按覆盖率排除表过滤后）。
 *
 * 为什么不能只查"非空字符串"：`coverage.include` 匹配不到任何文件时，v8 的汇总里没有测量
 * 对象，四项 100% 阈值照常通过、exit 0（实测把 include 指向一个不存在的目录，报告打出
 * `All files 0`）——"统计范围塌成空集"与"全部覆盖"在门禁输出上不可区分。
 * 检查点放在 `configResolved`：那里拿到的 `config.root` 是 CLI `--root` 解析后的真实根，
 * 既不依赖进程启动目录，也不会因为 `--root` 与 cwd 不同而查错目录。
 *
 * @param patterns - 原始 `coverageInclude`（未经 vitest 的 `/**` 归一化）
 * @param root - Vite 解析后的测试根
 * @param exclude - 生效的覆盖率排除表
 * @throws 任一模式零命中时抛出，点名模式与根
 */
export async function assertCoverageIncludeMatches(
  patterns: readonly string[],
  root: string,
  exclude: readonly string[],
): Promise<void> {
  // 每个模式只取第一条命中就收工：这里判的是"有没有测量对象"，不是给覆盖率做统计。
  // 模式只有几条，串行足够快；iterator.next() 不走 for await，避免 no-await-in-loop。
  const missing: string[] = [];
  for (const pattern of patterns) {
    const iterator = glob(pattern, { cwd: root, exclude: [...exclude] });
    // oxlint-disable-next-line no-await-in-loop -- 模式只有几条，串行取首条命中即可
    const first = await iterator.next();
    // oxlint-disable-next-line no-await-in-loop -- 同上，关闭 iterator 释放句柄
    await iterator.return?.();
    if (first.done === true) {
      missing.push(pattern);
    }
  }
  if (missing.length > 0) {
    throw new Error(`coverageInclude 在 ${root} 下没有命中任何文件：${missing.join("、")}。`);
  }
}

/** Vite 插件：配置解析完成时普查统计范围，抛错即启动失败（`config.root` 已含 `--root` 结果）。 */
function coverageIncludeCensus(patterns: readonly string[], exclude: readonly string[]): Plugin {
  return {
    name: "shared/census",
    configResolved: (config) => assertCoverageIncludeMatches(patterns, config.root, exclude),
  };
}

/**
 * 公共部分：各份配置里逐字相同的那部分，从今往后只有一处。
 * `testTimeout: 20_000` 是各包共同值（vitest 默认 5000）；继承它只会放宽不会收紧，
 * 故不会把任何已过用例变成不稳定。
 *
 * react 族不再有文件系统别名：`path.resolve(process.cwd(), "node_modules/react")` 绑定的是
 * 进程启动目录而不是测试根。实测从工作区根用 `--config <包>/vitest.config.ts --root <包>`
 * 跑时，别名指向一个不存在的目录，用例直接报 `Cannot find package 'react'`；而 cwd 下若
 * 恰有另一份 React，就会静默换成另一份实例。`resolve.dedupe` 在解析期按 Vite 根去重，
 * 不经过 cwd，且子路径（`react/jsx-runtime`、`react-dom/client`）仍走原包的 exports 映射
 * ——同一个模块 id 由 dedupe 保证，mock 与共享组件因此仍落在同一个实例上。
 */
export function definePackageConfig(options: PackageVitestOptions): PackageConfig {
  const { coverageInclude, coverage, test } = options;
  // 统计范围塌成空集/缺件时四项 100% 阈值照常通过，看似达标；vitest 对此不报错，只能在这里拦。
  if (coverageInclude.length === 0 || coverageInclude.some((entry) => entry.trim().length === 0)) {
    throw new Error("coverageInclude 不能为空或含空串：缺了测量对象，阈值仍会全绿。");
  }
  if (test !== undefined && Object.hasOwn(test, "coverage")) {
    throw new Error("test.coverage 不允许：覆盖率请走 coverage 参数逐键合并。");
  }
  const coverageOverrides = inheritUndefined(coverage);
  const coverageExclude = coverageOverrides.exclude ?? COVERAGE_BASE.exclude ?? [];
  const coverageThresholds = inheritUndefined(coverage?.thresholds);
  return defineConfig({
    // 客户端行在浏览器里是 `__ModuleLoader__` UMD，Node 测试直接执行会在 window 处抛错。
    // 测试侧把公开说明符映射到 `./client` 的 node 条件产物（ESM）；宿主仍从
    // exports["./client"].default 取 UMD。映射目标必须是**发布产物**：`files` 只带 dist，
    // 源码路径（lib/client-entry.ts）在 registry 安装态里不存在，映射过去等于让消费仓无测试可跑。
    plugins: [coverageIncludeCensus(coverageInclude, coverageExclude)],
    resolve: {
      alias: {
        "@jayyuen66/dsh-plugin-shared/client": CLIENT_NODE_ENTRY,
      },
      dedupe: ["react", "react-dom"],
    },
    test: {
      ...mergeTest(inheritUndefined(test)),
      coverage: {
        ...COVERAGE_BASE,
        ...coverageOverrides,
        include: coverageInclude,
        thresholds: { ...COVERAGE_BASE.thresholds, ...coverageThresholds },
      },
    },
  });
}
