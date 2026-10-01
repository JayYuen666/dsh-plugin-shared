// lib/record.ts —— unknown → Record 的窄化判据与单字段投影。
//
// 为什么值得单点定义：本仓 SP-D 台架实测 `isRecord` 37 处定义（31 处逐字同形、6 处只是
// `&&` 操作数换序——三个子句都是无副作用的类型/相等判定，`&&` 可交换故同余）、`fieldOf`
// 13 处全部逐字同形，满足 README「同一份样板在两处以上逐字同构地重复才收敛进来」的判据。
// 领域判定（例：某包「缺字段即视为该卡不存在」）不在本文件，留在各插件。

/** 对象类型守卫：非 `null` 的 `object` 且非数组（`Record` 索引签名投影的基础）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 `unknown` 投影单个字段；非 `Record` → `undefined`。 */
export function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
