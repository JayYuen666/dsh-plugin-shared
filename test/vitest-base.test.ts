// test/vitest-base.test.ts —— definePackageConfig 的合并行为。
//
// 覆盖率公共配置是四项 100% 阈值的关键保障：覆盖项必须逐键合并、`test` 里不许塞 `coverage`，
// 这两条一旦松动，某个包的一次局部改配就会静默变成整组检查失效。这里把两条固定在运行期；
// 统计范围的唯一来源约束（include 只由 coverageInclude 供给）固定在文末的编译期负向断言上。

import path from "node:path";
import { describe, expect, it } from "vitest";
import { definePackageConfig } from "../config/vitest.base.ts";
import type { PackageVitestOptions } from "../config/vitest.base.ts";

const SHARED_INCLUDE = ["lib/**/*.ts"];

const testBlockOf = (
  options: PackageVitestOptions,
): ReturnType<typeof definePackageConfig>["test"] => definePackageConfig(options).test;

describe("definePackageConfig 的合并行为", () => {
  it("公共配置完整：v8 provider、include 来自 coverageInclude、四项 100% 阈值", () => {
    expect(testBlockOf({ coverageInclude: SHARED_INCLUDE })?.coverage).toMatchObject({
      provider: "v8",
      include: SHARED_INCLUDE,
      thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
    });
  });

  it("coverage 覆盖项逐键合并：改 reporter 不动 exclude 与阈值", () => {
    const coverage = testBlockOf({
      coverageInclude: SHARED_INCLUDE,
      coverage: { reporter: ["text"] },
    })?.coverage;
    expect(coverage?.reporter).toStrictEqual(["text"]);
    expect(coverage?.exclude).toContain("test/**");
    expect(coverage?.thresholds).toStrictEqual({
      lines: 100,
      statements: 100,
      functions: 100,
      branches: 100,
    });
  });

  it("thresholds 之内也逐键合并：改一项不动其余三项", () => {
    expect(
      testBlockOf({
        coverageInclude: SHARED_INCLUDE,
        coverage: { thresholds: { lines: 90 } },
      })?.coverage?.thresholds,
    ).toStrictEqual({ lines: 90, statements: 100, functions: 100, branches: 100 });
  });

  it("test 字段照常透传，公共 include 不被挤掉", () => {
    const testBlock = testBlockOf({
      coverageInclude: SHARED_INCLUDE,
      test: { setupFiles: ["test/setup-logs.ts"] },
    });
    expect(testBlock?.setupFiles).toStrictEqual(["test/setup-logs.ts"]);
    expect(testBlock?.include).toStrictEqual(["test/**/*.{test,spec}.{ts,tsx,mts,cts}"]);
  });

  it("客户端行指向发布产物而不是源码，react 族钉回测试根，shared 内联进 Vite", () => {
    const config = definePackageConfig({ coverageInclude: SHARED_INCLUDE });
    // 映射目标必须是 exports 里的包内说明符：发布包的 files 只有 dist，源码路径在
    // registry 安装态不存在，指过去会让消费仓的测试装载期就找不到模块。
    expect(config.resolve?.alias).toMatchObject({
      "@jayyuen66/dsh-plugin-shared/client": "@jayyuen66/dsh-plugin-shared/client-node",
      react: path.resolve(process.cwd(), "node_modules/react"),
      "react-dom": path.resolve(process.cwd(), "node_modules/react-dom"),
    });
    // dedupe 与 alias 是两条面：alias 管测试侧显式导入，dedupe 管 Vite 解析时的同一实例。
    expect(config.resolve?.dedupe).toStrictEqual(["react", "react-dom"]);
    const inline = config.test?.server?.deps?.inline;
    if (!Array.isArray(inline)) {
      throw new TypeError("inline 规则不是数组：字符串形态按子串匹配，白名单会随路径漂移");
    }
    expect(inline).toHaveLength(1);
    const [pattern] = inline;
    if (!(pattern instanceof RegExp)) {
      throw new TypeError("inline 规则不是正则：字符串形态按子串匹配，会把同名的其它路径一并内联");
    }
    // 外部化交给 Node 加载器时，产物里的 import "react" 绕开 alias 与 vi.mock；
    // 内联这条规则让 shared 走 Vite 流水线，mock 才作用在同一个模块实例上。
    expect(pattern.test("@jayyuen66/dsh-plugin-shared/client")).toBe(true);
    expect(
      pattern.test("/tmp/node_modules/@jayyuen66/dsh-plugin-shared/dist/client-entry.js"),
    ).toBe(true);
    expect(pattern.test("other-package")).toBe(false);
  });

  it("用例形态放宽：spec 命名与 tsx/mts/cts 扩展位不再被静默漏跑，目录仍收在 test/ 下", () => {
    // 旧规则只认 test/**/*.test.ts：.spec.ts 与其余扩展位写了也不跑，vitest 对此不报错，
    // 套件可能以「无测试」通过。目录范围刻意不放宽——与源码同目录的用例不是本工作区的约定。
    expect(testBlockOf({ coverageInclude: SHARED_INCLUDE })?.include).toStrictEqual([
      "test/**/*.{test,spec}.{ts,tsx,mts,cts}",
    ]);
  });

  it("排除表补齐声明文件与嵌套的测试/依赖树（声明文件无可执行语句，不进统计范围）", () => {
    const exclude = testBlockOf({ coverageInclude: SHARED_INCLUDE })?.coverage?.exclude ?? [];
    // 空数组不算通过：排除表读不到时下面的循环什么都没量。
    expect(exclude.length, "覆盖率排除表是空的").toBeGreaterThan(0);
    for (const pattern of ["**/*.d.ts", "**/*.d.mts", "**/test/**", "**/node_modules/**"]) {
      expect(exclude, `排除表缺 ${pattern}`).toContain(pattern);
    }
  });

  it("coverageInclude 为空数组即抛：统计范围塌成空集后四项 100% 照常通过，看似达标", () => {
    expect(() => definePackageConfig({ coverageInclude: [] })).toThrow(/coverageInclude/u);
  });

  it("coverageInclude 含空串同样即抛（路径写错最常见的形态是少一层目录后剩下空段）", () => {
    expect(() => definePackageConfig({ coverageInclude: ["lib/**/*.ts", "  "] })).toThrow(
      /coverageInclude/u,
    );
  });

  it("test.coverage 被拒绝：整块替换会让阈值与排除表静默消失", () => {
    expect(() =>
      definePackageConfig({
        coverageInclude: SHARED_INCLUDE,
        test: { coverage: { reporter: ["json"] } },
      }),
    ).toThrow(/coverage 参数/u);
  });
});

// 编译期负向断言：覆盖项不接受 include。约束一旦撤掉，下面这行不再报错，
// tsc 报 unused directive，本文件判定失败。指令只压紧邻一行，所以目标必须单行。
export const rejectsIncludeInCoverage: PackageVitestOptions = {
  coverageInclude: [],
  // @ts-expect-error include 不在覆盖项形状里：统计范围由 coverageInclude 单独供给
  coverage: { include: ["x"] },
};
