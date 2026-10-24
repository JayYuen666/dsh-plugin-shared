// test/vitest-base.test.ts —— definePackageConfig 的合并契约。
//
// 覆盖率公共面是四项 100% 阈值的承重墙：覆盖项必须逐键合并、`test` 里不许塞 `coverage`，
// 这两条一旦松动，某个包的一次局部改配就会静默变成整片门禁失效。这里把两条钉在运行期；
// 统计面的单源约束（include 只由 coverageInclude 供给）钉在文末的编译期负向断言上。

import { describe, expect, it } from "vitest";
import { definePackageConfig } from "../config/vitest.base.ts";
import type { PackageVitestOptions } from "../config/vitest.base.ts";

const SHARED_INCLUDE = ["lib/**/*.ts"];

const testBlockOf = (
  options: PackageVitestOptions,
): ReturnType<typeof definePackageConfig>["test"] => definePackageConfig(options).test;

describe("definePackageConfig 的合并契约", () => {
  it("公共面完整：v8 provider、include 来自 coverageInclude、四项 100% 阈值", () => {
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

  it("用例形态放宽：spec 命名与 tsx/mts/cts 扩展位不再被静默漏跑，目录仍收在 test/ 下", () => {
    // 旧口径只认 test/**/*.test.ts：.spec.ts 与其余扩展位写了也不跑，vitest 对此不报错，
    // 套件可能以「无测试」通过。目录范围刻意不放宽——与源码同目录的用例不是本工作区的约定。
    expect(testBlockOf({ coverageInclude: SHARED_INCLUDE })?.include).toStrictEqual([
      "test/**/*.{test,spec}.{ts,tsx,mts,cts}",
    ]);
  });

  it("排除表补齐声明文件与嵌套的测试/依赖树（声明文件无可执行语句，不进统计面）", () => {
    const exclude = testBlockOf({ coverageInclude: SHARED_INCLUDE })?.coverage?.exclude ?? [];
    // 空数组不打勾：排除表读不到时下面的循环什么都没量。
    expect(exclude.length, "覆盖率排除表是空的").toBeGreaterThan(0);
    for (const pattern of ["**/*.d.ts", "**/*.d.mts", "**/test/**", "**/node_modules/**"]) {
      expect(exclude, `排除表缺 ${pattern}`).toContain(pattern);
    }
  });

  it("coverageInclude 为空数组即抛：统计面塌成空集后四项 100% 照常通过，是假绿灯", () => {
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
// tsc 报 unused directive，本文件转红。指令只压紧邻一行，所以目标必须单行。
export const rejectsIncludeInCoverage: PackageVitestOptions = {
  coverageInclude: [],
  // @ts-expect-error include 不在覆盖项形状里：统计面由 coverageInclude 单源供给
  coverage: { include: ["x"] },
};
