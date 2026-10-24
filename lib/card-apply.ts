// lib/card-apply.ts —— 客户端设置卡片 apply 骨架。
//
// 设置卡片各自重复样板中**逐字同构**的部分（其余 CSS / slots.inject /
// 卡组件差异大，保留在各卡片）：apply 幂等守卫——globalThis 上的**自有**占位标记 +
// ctx.effect 卸载清理（HMR / 重复加载防护）。占位值是每次 claim 现造的一枚 symbol，
// 但对外判据刻意同时认 `true`（外部写 true 也算占位）：值与身份分开后，清理只认
// 自己那枚 token，旧实例迟到的 disposer 清不掉新实例刚占的位。
// 消费方现量（`grep -rn claimApply` 各仓 `src/client-entry.ts`）：session-rescue、
// ocr-review、scrapling 三张卡各占一枚自己的 flag。lesson-loop 的卡片刻意不用这一枚，
// 它按 ctx 用 WeakSet 记账——理由写在它自己的 client-entry 注释里（单枚进程级旗标会被
// 同一页面的第二个 ctx 挡掉），本文件只把那条限制登记在下面 `claimApply` 的说明里。
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
 * ⚠ 为什么这条要紧：各卡片的 `ClientCtx.effect` 绑的就是官方类型，而本地那份把 factory 的
 * 值域写**宽**了（官方 `SyncEffect` 不收 `undefined`）。函数属性位按 contravariance 检查，
 * 于是「官方 ctx」反而赋不进本投影——各卡片包会各自撞出一个
 * `TS2345 … Type 'undefined' is not assignable to type 'SyncEffect<any>'`，
 * 并在每个消费包里用一个类型断言去过桥。守卫的 ctx 面归本模块所有，就在这里一次修好。
 */
export interface CardApplyCtx {
  effect: Context["effect"];
}

/**
 * flag 的合法形态：非空、且不得命中 `Object.prototype` 的成员。`__proto__` 写不进自有属性
 * （setter 忽略非对象值），函数却返回 true，守卫从此永远失灵；`__defineGetter__` 一类会在
 * globalThis 上落下自有属性、遮蔽同名原型方法——装载即抛。`__` 前缀是各消费卡的书写
 * 惯例，不是判据：判据只拦真正会破坏守卫或全局对象的键。
 */
const isLegalClaimFlag = (flag: string): boolean => flag.length > 0 && !(flag in Object.prototype);

/**
 * 把占位槽恢复到 claim 之前的状态。此前没有自有属性时置 `undefined` 而非 delete：
 * 删动态键会被本仓 lint 基线的 typescript/no-dynamic-delete 判红，它援引的正是
 * 「频繁 delete 会把对象推进 V8 字典模式、内联缓存失效」那一条——判据读的是
 * 「是否仍被占位」，残留的 undefined 键不影响守卫。
 */
function restoreClaimSlot(
  marker: Record<string, unknown>,
  flag: string,
  previous: PropertyDescriptor | undefined,
): void {
  if (previous === undefined) {
    marker[flag] = undefined;
    return;
  }
  Object.defineProperty(marker, flag, previous);
}

/**
 * apply 幂等守卫：已 claim 返回 false（调用方直接 return），否则占位并
 * 挂 ctx.effect 清理——HMR 重载时 flag 复位，再次 apply 可重新声明。
 *
 * 占位值是本次 claim 现造的 symbol；守卫对外的判据面是「自有键上的 `true` 或任何 symbol」：
 * `true` 是外部可写的占位协议（判据放宽一分就重新打开 HMR 重复装载），symbol 品牌让
 * 重复加载的另一份模块实例的占位同样被认出——两份实例各持各的 token，靠 typeof 而不是
 * 身份对上。清理只认**自己那枚** token：旧实例的 disposer 迟于新实例 claim 执行（HMR /
 * 重复加载不保证时序，也不保证恰好调一次）时，它认不得新实例的占位，新 claim 得以保留；
 * claim 之前槽上已有的自有值按原样恢复，不抹成 undefined。
 *
 * ⚠ 标记是**进程级**的（同一枚 flag 在全页面只有一份），不是 per-ctx：同一张卡被第二个
 * ctx apply 时会被这一枚挡掉。要允许多 ctx 共存就得按 ctx 记账（WeakSet 一类），
 * 别改成这里"顺手放过第二次"——那会重新打开 HMR 重复装载这条路。
 * @param ctx   - apply 的 ctx（需要 effect）。
 * @param flag  - globalThis 上的占位标记键名（如 "__xxxCardApplied"），形态见 {@link isLegalClaimFlag}。
 * @param label - effect 标签（日志/生命周期可观测）。
 * @returns true 表示本次拿到声明权（继续执行），false 表示已被占位。
 */
export function claimApply(ctx: CardApplyCtx, flag: string, label: string): boolean {
  if (!isLegalClaimFlag(flag)) {
    throw new Error(
      `claimApply 的 flag 不得为空、也不得命中 Object.prototype 的成员（__proto__ 一类会让占位静默失灵或遮蔽全局成员）：${flag}`,
    );
  }
  const marker: Record<string, unknown> = globalThis;
  // 判据只认**自有**的占位：首次 claim 前这枚键根本没有自有属性，裸下标读的是原型链，
  // `Object.prototype[flag] = true` 就能让这张卡从此静默不挂载（`!claimApply(...)` 直接 return，
  // 界面上什么痕迹都不留）。与 lib/locale.ts 读设置偏好时同一口径——那里把这条失败模型
  // 连同实测一起写在了调用点上。
  const current = Object.hasOwn(marker, flag) ? marker[flag] : undefined;
  if (current === true || typeof current === "symbol") {
    return false;
  }
  const previous = Object.getOwnPropertyDescriptor(marker, flag);
  const token = Symbol(flag);
  marker[flag] = token;
  try {
    ctx.effect(
      () => () => {
        // 只清自己那枚：值与身份分开，旧实例迟到的 disposer 认不得新实例的 token。
        if (marker[flag] === token) {
          restoreClaimSlot(marker, flag, previous);
        }
      },
      label,
    );
  } catch (error) {
    // 挂不上 effect 就等于这次**没拿到**声明权（清理没挂成，将来无人复位）。标记必须原样退回：
    // 否则占位会一直挂着，这条 apply 从此永远返回 false，守卫从"防重复"退化成"禁止再挂"，
    // 而除了整页刷新没有别的补救。异常照旧上抛——调用方要看见它，且它不是本守卫的责任。
    if (marker[flag] === token) {
      restoreClaimSlot(marker, flag, previous);
    }
    throw error;
  }
  return true;
}
