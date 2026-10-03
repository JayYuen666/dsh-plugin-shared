// lib/card-apply.ts —— 客户端设置卡片 apply 骨架。
//
// 8 张设置卡片各自重复样板中**逐字同构**的部分（其余 CSS / slots.inject /
// 卡组件差异大，保留在各卡片）：apply 幂等守卫——globalThis.__<flag> 标记 +
// ctx.effect 卸载清理（HMR/重复加载防护，session-rescue 同款做法）。
// memory-tdai-card / memory-insight-card / wukil-dev-tools-card 三张已用，
// 其余卡片若后续补守卫可直接复用。
//
// 零依赖纯函数：不使用 node 内建，运行时也只有 globalThis 一处读写（host/客户端两套
// tsconfig 都可编译）。下面那条 cordis 导入是 **type-only**，`verbatimModuleSyntax` 下
// 整条擦除，浏览器产物与内联样板等价——跨包引用被 rolldown/tsc 内联，不产生额外载入。

import type { Context } from "@deepseek-ai/cordis";

/**
 * 客户端 apply 接收的 ctx 最小面。
 * `effect` 逐字取官方 `Context['effect']`（installed
 * `@deepseek-ai/cordis/lib/types/fiber.d.ts`：`interface Context extends
 * Pick<Fiber, 'effect'>`，同步 `Disposable` 与可 await 的 `AsyncDisposable` 两条重载），
 * 而不是本地重述一条 `(factory: () => (() => void) | undefined, label?) => void`。
 * ⚠ 为什么这条要紧：各卡片的 `ClientCtx.effect` 现在也绑官方，而本地那份把 factory 的
 * 值域写**宽**了（官方 `SyncEffect` 不收 `undefined`）。函数属性位按 contravariance 检查，
 * 于是「官方 ctx」反而赋不进本投影——三个卡片包会各自撞出一个
 * `TS2345 … Type 'undefined' is not assignable to type 'SyncEffect<any>'`，
 * 并在每个消费包里用一个类型断言去过桥。守卫的 ctx 面归本模块所有，就在这里一次修好。
 */
export interface CardApplyCtx {
  effect: Context["effect"];
}

/**
 * apply 幂等守卫：已 claim 返回 false（调用方直接 return），否则占位并
 * 挂 ctx.effect 清理——HMR 重载时 flag 复位，再次 apply 可重新声明。
 * @param ctx   - apply 的 ctx（需要 effect）。
 * @param flag  - globalThis 上的布尔标记键名（如 "__xxxCardApplied"）。
 * @param label - effect 标签（日志/生命周期可观测）。
 * @returns true 表示本次拿到声明权（继续执行），false 表示已被占位。
 */
export function claimApply(ctx: CardApplyCtx, flag: string, label: string): boolean {
  const marker: Record<string, unknown> = globalThis;
  if (marker[flag] === true) {
    return false;
  }
  marker[flag] = true;
  ctx.effect(
    () => () => {
      // 置 undefined 而非 delete：删动态键会被本仓 lint 基线的 typescript/no-dynamic-delete
      // 判红，它援引的正是「频繁 delete 会把对象推进 V8 字典模式、内联缓存失效」那一条。
      // 语义上两者等价——判据是 `=== true`，残留的 undefined 键不影响守卫；真要字面意义上的
      // "从未 claim 过"，该换个键名，而不是在这里删键。
      marker[flag] = undefined;
    },
    label,
  );
  return true;
}
