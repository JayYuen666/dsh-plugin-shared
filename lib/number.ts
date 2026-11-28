// lib/number.ts —— 数值钳制与三段版本比较（零依赖）。
//
// 为什么值得单点定义：dir-prep 的 `clampInt` 与 lesson-loop 的 `clampPageSize` 是同一类
// 「有限数才收、trunc 后夹在闭区间」的输入钳制；rtk 的 `isRtkVersionSupported` 与 zvec 的
// `versionAtLeast` 是同一套逐段比较。两族都不该在各仓各写一遍。
//
// 刻意不收的：shared/card-ui 与各卡里的 `Math.min(Math.max(...))` 布局计算。它们的值域是
// 像素/比例，不是用户输入，没有 fallback 语义；把它们也折进来只会让一个通用钳制函数
// 承担两种失败策略。

/** 三段版本号；只认非负安全整数的调用方负责先解析。 */
export interface VersionParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * `actual` 是否 >= `minimum`：逐段比数值，不是比字符串。
 *
 * 字符串比较会把 `0.10.0` 判成小于 `0.9.0`；逐段数值比较没有这个坑。
 * @param actual - 实际版本
 * @param minimum - 下限版本
 * @returns actual >= minimum 时为 true
 */
export function versionAtLeast(actual: VersionParts, minimum: VersionParts): boolean {
  if (actual.major !== minimum.major) {
    return actual.major > minimum.major;
  }
  if (actual.minor !== minimum.minor) {
    return actual.minor > minimum.minor;
  }
  return actual.patch >= minimum.patch;
}

/**
 * 整数输入钳制：非有限数（NaN/±Infinity）落 fallback，其余先 trunc 再夹到闭区间。
 *
 * 为什么单独要一个函数：`Math.min(Math.max(NaN, min), max)` 的结果是 `NaN`，两个 clamp
 * 都不会把它救回来；而 `NaN` 进到下游定时器/分页参数会变成「看起来设了、实际没设」。
 * @param value - 用户输入
 * @param min - 闭区间下界
 * @param max - 闭区间上界
 * @param fallback - 非有限数时的回落值
 * @returns 夹在 [min, max] 的整数，或 fallback
 */
export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}
