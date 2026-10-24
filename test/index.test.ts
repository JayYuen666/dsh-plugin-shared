// test/index.test.ts —— 入口 barrel 冒烟：根导出是留给「一次引入全部切面」的调用方
// （含外部插件作者）的，本仓消费方一律按 `@jayyuen66/dsh-plugin-shared/lib/<facet>` 子路径取；
// 某条 re-export 断了要在装载期就炸出来，而不是等运行时 "xxx is not a function"。

import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  claimApply,
  deriveProjectKey,
  diffTouched,
  editPathOf,
  errorText,
  fieldOf,
  hasMethods,
  isRecord,
  isSettingsConflict,
  jobOutcomeOf,
  killProc,
  messagesFor,
  resolveLocale,
  scanToolEvents,
  settleLessonCall,
  shrinkJsonlTail,
  truncateEnd,
  truncateStart,
} from "../lib/index.ts";

const pkgDir = path.join(import.meta.dirname, "..");

/** barrel 自己那一份源文件（它是被比的那一侧，不进切面清单）。 */
const BARREL_FILE = "index.ts";

/**
 * 不进 barrel 的切面：构建期件按设计只给子路径（`canonicalize-region-paths` 是产物正典化，
 * `build-*` 四枚是各包 build-*.mjs 的统一编排）——运行期消费方不该为它们付一次导入。
 * 同一条限制由 `test/publish-manifest.test.ts` 钉着。
 */
const BARREL_EXEMPT = new Set([
  "canonicalize-region-paths.ts",
  "build-artifacts.ts",
  "build-host.ts",
  "build-client.ts",
  "build-types.ts",
]);

describe("lib/index 聚合导出", () => {
  it("根 barrel 把每一面的公开成员都作为函数导出", () => {
    for (const fn of [
      scanToolEvents,
      editPathOf,
      claimApply,
      deriveProjectKey,
      messagesFor,
      resolveLocale,
      settleLessonCall,
      truncateEnd,
      truncateStart,
      isRecord,
      fieldOf,
      errorText,
      shrinkJsonlTail,
      jobOutcomeOf,
      killProc,
      diffTouched,
      hasMethods,
      isSettingsConflict,
    ]) {
      expect(fn).toBeTypeOf("function");
    }
  });

  // 上面那份名单是手写的，所以它只证「列出来的成员确实还在」，证不到「该列的没被漏列」：
  // 新增一枚 lib/<facet>.ts 时，publish-manifest 的 parity 查的是「切面 ↔ exports 子路径」，
  // 这条查的是「名字 ↔ 那份手写清单」，两边都不会因为 barrel 少一条 re-export 而红。
  // 漏掉的那一面于是只在消费方 `import { x } from "@jayyuen66/dsh-plugin-shared"` 那天
  // 以运行期 undefined 现形——正是本文件开头要防的那件事。
  it("barrel 覆盖 lib/ 下每一面的每一个值导出（清单不许自己腐烂）", async () => {
    const listed = await readdir(path.join(pkgDir, "lib"));
    const facetFiles = listed
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => name !== BARREL_FILE && !BARREL_EXEMPT.has(name));
    // 空集不打勾：整片扫不到切面时这条门什么都没量。
    expect(facetFiles.length, "lib/ 下没扫到切面").toBeGreaterThan(0);
    // 一次 Promise.all 取齐（基线 no-await-in-loop）；动态 import 对 TS 是 any，逐枚收窄成取值面。
    const surfaces = await Promise.all(
      [BARREL_FILE, ...facetFiles].map(async (file) => ({
        file,
        names: Object.keys(
          (await import(path.join(pkgDir, "lib", file))) as Record<string, unknown>,
        ),
      })),
    );
    // barrel 固定是第一枚（上面那个数组由我们自己排），所以不必 find；读空了要点名判红，
    // 否则下面整片短路成"真空为真"。
    const [barrelSide, ...facetSides] = surfaces;
    expect(barrelSide?.names.length, "lib/index.ts 没读到任何值导出").toBeGreaterThan(0);
    const barrelNames = new Set(barrelSide?.names);
    for (const surface of facetSides) {
      for (const exported of surface.names) {
        expect(
          barrelNames.has(exported),
          `lib/${surface.file} 导出了 ${exported}，但 lib/index.ts 的 barrel 里没有它`,
        ).toBe(true);
      }
    }
  });
});
