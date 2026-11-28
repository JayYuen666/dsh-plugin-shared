// lib/instance-lock.ts —— 「同一作用域里只让一份 apply 走注册面」的单实例锁。
//
// 为什么需要它：dshmarket 在运行期热装插件时，会在 `<profile>/.dsh-market/` 下造一棵
// market 自己的 Include 子树（条目 id 形如 `mkt-<包>`），把**同一份 host.js** 再挂一次；
// 而 profile 的 `dsh.profile.bundles` 那条 bundle 行仍会被宿主按 patch 重新组装。于是同一个
// 进程里 `apply` 跑两遍，注册面（工具 / prompt section / Typert Remote 服务 / skill / MCP）
// 在第二遍全部撞「同名已注册」而抛错；抛错穿出 `apply` ⇒ 那条 fiber 落 `failed`，用户在插件页
// 看到「启动失败」。这不是环境残留，是双路径装载的正常形态（market 侧只对「只有 client、没有
// bundle」的包做了防双挂，见 dshmarket 的 #1137）。market 的 `hot-*.yml` 每次 boot 被 wipe、
// 持久状态留在 `dsh.profile.bundles`，所以「后到者让路」与持久性天然一致：下一次启动只剩
// bundle 层一条，自己就会恢复。
//
// 为什么是「抢一把私有服务名」而不是「先看有没有同名工具就让路」：同名不等于同一个插件写的
// ——别的插件也可能注册同名 section 或遮蔽 `bash`；而这把锁的键是**只有本包会用的名字**，
// 不会把别人的注册误判成自己，且它天然随 fiber 卸载释放（`reflect.provide` 的 disposer 归
// 调用方 fiber 所有），不需要另写回收逻辑。
//
// 判据边界（都实测过）：① `reflect.provide` 对同一作用域的重复名字是在 effect 工厂里**同步**
// 抛错，所以 try/catch 能就地接住；② 接住之后同一 fiber 仍能继续注册别的服务，fiber 不会因此
// 落 failed；③ `ctx.get(锁名)` 在释放后回 `undefined`，所以卸载后下一次装配能重新抢到。
//
// 调用侧有一条容易写错的地方：**`reflect` 要整个传进来，不要再包一层
// `{ provide: (n, v) => ctx.reflect.provide(n, v) }`**。包出来的箭头恒是函数，于是「这台上下文
// 根本没有注册口」这一档（单测替身、精简宿主）会被伪装成「有注册口但 provide 抛错」，让路判据
// 当场误判成「已有一份在册」而把整份插件关掉。缺注册口的判定归 `claimInstance` 自己做
// （按 `typeof provide !== "function"` 放行）。
//
// 只经 `./tool` barrel 取用（构建期解析为 `./internal/tool/instance-lock`），不进根 barrel：进 barrel 会让每个消费方都为这把锁多一次
// 导入，而它只有宿主侧 `apply` 用得到（`BARREL_EXEMPT` 与 build-host.mjs 的 entries 各登记一份）。

/** 抢锁需要的最小上下文面：读服务的 `get` + 注册服务的 `reflect.provide`。 */
export interface InstanceLockContext {
  /** 官方 `Context["get"]`：服务不存在时回 `undefined`，不抛。 */
  readonly get: (name: string) => unknown;
  /**
   * 官方 `Context["reflect"]`。写成可选：替身上下文未必给注册口，而「没有注册口」是能力缺席
   * 而不是重复装载 —— 那一档必须放行（拦下来等于把插件关掉）。
   */
  readonly reflect?:
    | { readonly provide?: ((name: string, value?: unknown) => unknown) | undefined }
    | undefined;
}

/**
 * 尝试成为本作用域里的唯一实例。
 *
 * @param ctx - 宿主上下文（只用到 `get` 与 `reflect.provide` 两位）
 * @param key - 只有本包会用的私有服务名；同一个 ctx 上用不同键抢锁互不影响
 * @returns true = 抢到（可以去注册）；false = 已有一份在册（本次装配应安静让路）
 */
export function claimInstance(ctx: InstanceLockContext, key: string): boolean {
  // 先读：已有一份在册就直接让路，连 provide 都不必试（它的报错文案会误导成「装配出错」）。
  if (ctx.get(key) !== undefined) {
    return false;
  }
  const registry = ctx.reflect;
  // 没有注册口 = 这个上下文不提供该能力（替身 / 精简宿主）。此时无从判断是否重复，
  // 按「能力缺席不拦功能」放行 —— 与各 installer 对 `reflect.provide` 缺席的处理同档。
  if (registry === undefined || typeof registry.provide !== "function") {
    return true;
  }
  try {
    // 成员调用而不是先取出函数：cordis 的 reflect 是对象方法，取出来会丢 `this`。
    registry.provide(key, {});
  } catch {
    // 走到了 catch：名字在「读」与「写」之间被另一份抢走（或它被声明成了别种属性）。
    // 结论与读到已有实例相同 —— 让路。
    return false;
  }
  return true;
}
