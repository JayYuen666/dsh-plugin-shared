// lib/session-projection.ts —— `ctx.sessionProjections` 新旧两代注册协议的判别件。
//
// 收编标准见 README「逐字相同是收录标准」：三个单元此前在 dsh-danger-guard 与
// dsh-session-rescue 的 projection-reader 里逐字相同（md5 一致，含注释），判序
// （先判 handle 后判 disposer）也逐字一致——判序是两份注释各自强调的承重点：把
// 可调用性同时当成 handle 的排除条件时，一份「可调用 + 带 stateOf/dispose」的合成值
// 会掉进旧读口，去调注册表上已弃用的双参 `stateOf(session, key)`，读错来源且不报错。
//
// 两仓的挂载主体（发布/撤下/卸载收尾）**不在**收编范围：danger-guard 全 fail-open
// （register 抛错退回日志扫描），session-rescue 全 fail-fast（抛给调用方）——失败语义
// 相反，正是收录标准点名的「留在原地」情形。
//
// ⚠ 只在 `./lib/session-projection` 子路径上取用，不进根 barrel：消费方只有两个，
// 进 barrel 只会让其余七个运行期消费方为它多一次导入。

/** 新版注册的结果：可读、可释放。 */
export interface ProjectionHandle {
  readonly stateOf: (session: unknown) => unknown;
  readonly dispose: () => Promise<void> | undefined;
}

/** 旧版注册的结果就是 disposer 本身。 */
export const isDisposer = (value: unknown): value is () => void => typeof value === "function";

/** 新版注册的结果：可读、可释放。判据只看这两位方法在不在，**不看可调用性**——宿主当前的
 *  handle 是对象，但可调用性本是旧协议（disposer）的唯一判据，把它同时当成排除条件时，
 *  一份「可调用 + 带 stateOf/dispose」的合成值会掉进旧读口，去调注册表上已弃用的
 *  `stateOf(session, key)`，读错来源且不报错。 */
export const isProjectionHandle = (value: unknown): value is ProjectionHandle =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { stateOf?: unknown }).stateOf === "function" &&
  typeof (value as { dispose?: unknown }).dispose === "function";

/**
 * 按两仓逐字一致的判序分派注册结果：先 handle 后 disposer，都判不上交回 null。
 * `null` 的处置是各仓自己的失败策略（fail-open / fail-fast），本模块不代答。
 */
export function discriminateProjection(value: unknown): "handle" | "disposer" | null {
  if (isProjectionHandle(value)) {
    return "handle";
  }
  if (isDisposer(value)) {
    return "disposer";
  }
  return null;
}
