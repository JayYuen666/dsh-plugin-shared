// lib/errors.ts —— 把 `unknown` 的错误归一成界面可显示的文本。
//
// 收录依据：SP-D 台架实测本仓 7 处 `messageOf`/`errorText` 逐字同形（`error instanceof
// Error ? error.message : String(error)`），满足 README「两处以上逐字同构才收敛」。
// 刻意**不含**三件异形件，它们各自的兜底值就是本包语义，合并即改行为：
//   quality-gate/host.ts 的 messageOf —— 非 Error 走 "unknown error"，不是 String(error)；
//   session-rescue/host.ts 的 errorText —— 用 fieldOf 读 .message，不吃 instanceof；
//   ctx-observe/host.ts 的 describeError —— 多一层 try，防 String() 自己抛。
// lesson-loop/lib/lesson-store.ts 的 describeError 曾与本文件**同体异名**且被 export 给
// 三个消费面，SP-D 登记为下一轮；**G2（2026-09-26）已收**：本出口成为唯一定义，
// lesson-loop 的 12 个 catch 站点按名改调 errorText（ctx-observe 那份仍属上面的异形件，
// 因为它多的一层 try 是真语义）。

/** `Error` 取 `message`，其余一律 `String(error)`（`null` → `"null"`，对象 → 其 `toString()`）。 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
