// lib/card-apply.ts —— 客户端设置卡片 apply 的公共实现。
//
// 设置卡片各自重复样板中**逐字相同**的部分（其余 CSS / slots.inject /
// 卡组件差异大，保留在各卡片）：apply 幂等保护——globalThis 上的**自有**占位标记 +
// ctx.effect 卸载清理（HMR / 重复加载防护）。占位值是每次 claim 现造的一个 symbol，
// 但对外判断刻意同时认 `true`（外部写 true 也算占位）：值与身份分开后，清理只认
// 自己那个 token，旧实例迟到的 disposer 清不掉新实例刚占的位。
//
// 这条保护的全部槽位读写都走 PropertyDescriptor（Object.getOwnPropertyDescriptor /
// Object.defineProperty / Reflect.deleteProperty），不做普通下标赋值或读取。否则
// 遇到自有访问器、或 globalThis 原型链上的同名 setter 时，赋值可能成功却没有落下
// 自有 token，清理时的普通读取又会执行 getter；结果是「守卫静默失效、两张卡重复
// 挂载」或「token 留在 getter 后面，下一次永远 claim 不到」。这两种形态都由本模块
// 的临时探针在 cordis 4.2.0-alpha.1 上实测过。
//
// 形态契约：flag 对应的自有槽只能是**可配置的数据属性**；访问器、占位协议之外的旧值
// （number/string/object 一类）、以及需要认领的不可配置自有槽一律明确抛错，不静默
// 覆盖其他全局属性。没有自有槽时用 defineProperty 建自己的槽，原型链上的同名 setter
// 不会被执行；原型链上是访问器或非协议值时同样拒绝。
//
// 消费方现状（`grep -rn claimApply` 各仓 `src/client-entry.ts`）：session-rescue、
// ocr-review、scrapling 三张卡各用一个自己的 flag。lesson-loop 的卡片刻意不用这一个，
// 它按 ctx 用 WeakSet 管理——理由写在它自己的 client-entry 注释里（单枚全局标记会被
// 同一页面的第二个 ctx 拒绝），本文件只把那条限制登记在下面 `claimApply` 的说明里。
//
// 零依赖纯函数：不使用 node 内建，运行时只有 globalThis 一处状态（host/客户端两套
// tsconfig 都可编译）。下面那条 cordis 导入是 **type-only**，`verbatimModuleSyntax` 下
// 整条擦除；`dist/card-apply.js` 不引 cordis。真正给消费包的运行时值从 `./client`
// 导出（shared/client），消费包的 `dsh.client.external` 保证它由供应行提供一次，
// 不是每个消费包各内联一份。

import type { Context } from "@deepseek-ai/cordis";

/**
 * 客户端 apply 接收的 ctx 最小接口。
 * `effect` 逐字取官方 `Context['effect']`（installed
 * `@deepseek-ai/cordis/lib/types/fiber.d.ts`：`interface Context extends
 * Pick<Fiber, 'effect'>`，同步 `Disposable` 与可 await 的 `AsyncDisposable` 两条重载），
 * 而不是本地重述一条 `(factory: () => (() => void) | undefined, label?) => void`。
 * ⚠ 为什么这条要紧：各卡片的 `ClientCtx.effect` 绑的就是官方类型，而本地那份把 factory 的
 * 值域写**宽**了（官方 `SyncEffect` 不收 `undefined`）。函数属性位按 contravariance 检查，
 * 于是「官方 ctx」反而赋不进本投影——各卡片包会各自出现一个
 * `TS2345 … Type 'undefined' is not assignable to type 'SyncEffect<any>'`，
 * 并在每个消费包里用一个类型断言绕过它。守卫的 ctx 类型归本模块所有，就在这里一次修好。
 */
export interface CardApplyCtx {
  effect: Context["effect"];
}

/**
 * 只看占位协议关心的四个 descriptor 字段：`get`/`set` 一律不走普通属性读取，
 * 用 `"value" in descriptor` 区分数据槽与访问器，避免把 `any` 带进判断。
 */
interface ClaimSlotDescriptor {
  value?: unknown;
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
}

/**
 * flag 的合法形态：非空、且不得命中 `Object.prototype` 的成员。`__proto__` 写不进自有属性
 * （setter 忽略非对象值），函数却返回 true，守卫从此永远失灵；`__defineGetter__` 一类会在
 * globalThis 上落下自有属性、遮蔽同名原型方法——装载即抛。`__` 前缀是各消费卡的书写
 * 惯例，不是判断依据：判断只拦真正会破坏保护逻辑或全局对象的键。
 *
 * 这里只查键名本身。键对应的槽是否可写、是否访问器、是否撞上其他全局属性，由
 * {@link claimApply} 的 descriptor 检查负责。
 */
const isLegalClaimFlag = (flag: string): boolean => flag.length > 0 && !(flag in Object.prototype);

function accessorSlotError(flag: string, where: string): Error {
  return new Error(`claimApply: flag "${flag}" 在 ${where} 是访问器；占位槽须为可配置数据属性`);
}

function collisionError(flag: string, where: string, value: unknown): Error {
  return new Error(`claimApply: flag "${flag}" 在 ${where} 有非占位值（${typeof value}）`);
}

/**
 * 判断一个既有槽值是否属于本模块认识的占位协议：
 * `undefined` / `false` 是清理后或外部留下的未占位痕迹，`true` / `symbol` 是占位。
 * 其他值（number/string/object/function 等）一律视为撞上了别的全局属性，不能覆盖。
 */
function assertKnownSlotValue(flag: string, where: string, value: unknown): void {
  if (value === undefined || value === false || value === true || typeof value === "symbol") {
    return;
  }
  throw collisionError(flag, where, value);
}

/** 沿原型链找同名属性。只读 descriptor，不触发 getter/setter。 */
function findInheritedDescriptor(target: object, flag: string): ClaimSlotDescriptor | null {
  let proto = Reflect.getPrototypeOf(target);
  while (proto !== null) {
    const descriptor: ClaimSlotDescriptor | undefined = Object.getOwnPropertyDescriptor(
      proto,
      flag,
    );
    if (descriptor !== undefined) {
      return descriptor;
    }
    proto = Reflect.getPrototypeOf(proto);
  }
  return null;
}

/**
 * 把占位槽恢复到 claim 之前的状态：此前有自有属性就按原 descriptor 写回；此前没有
 * 自有属性就删掉本次创建的键，精确恢复「键不存在」——不留下 undefined 自有键。
 * `Reflect.deleteProperty` 不是 `delete` 运算符，避开 lint 基线的 no-dynamic-delete；
 * 删除失败只可能是 claim 之后槽被外部改成不可配置，此时明确抛错，不静默留下占位。
 */
function restoreClaimSlot(
  target: object,
  flag: string,
  previous: ClaimSlotDescriptor | undefined,
): void {
  if (previous === undefined) {
    if (!Reflect.deleteProperty(target, flag)) {
      throw new Error(`claimApply: 占位槽 "${flag}" 不可删除`);
    }
    return;
  }
  Object.defineProperty(target, flag, previous);
}

/**
 * 只释放本次 claim 自己的 token。整个函数不读普通属性：若槽被外部换成访问器，
 * 这里不会触发 getter；若槽上的值已不是自己的 token，也不清别人的占位。
 */
function releaseClaim(
  target: object,
  flag: string,
  token: symbol,
  previous: ClaimSlotDescriptor | undefined,
): void {
  const descriptor: ClaimSlotDescriptor | undefined = Object.getOwnPropertyDescriptor(target, flag);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.value !== token) {
    return;
  }
  restoreClaimSlot(target, flag, previous);
}

/**
 * 解析既有槽，回答「已占位」还是「可认领」，并把原 descriptor 留作恢复用。
 * 访问器、需要认领的不可配置槽、非协议值都在这里统一拒绝；返回结构让 claimApply
 * 主流程只剩下「拿 token → 写槽 → 挂 effect → 失败回滚」。
 */
function resolveClaimSlot(
  target: object,
  flag: string,
): { occupied: boolean; previous: ClaimSlotDescriptor | undefined } {
  const own: ClaimSlotDescriptor | undefined = Object.getOwnPropertyDescriptor(target, flag);
  if (own !== undefined) {
    if (!("value" in own)) {
      throw accessorSlotError(flag, "globalThis 自有槽");
    }
    const { value } = own;
    if (value === true || typeof value === "symbol") {
      return { occupied: true, previous: undefined };
    }
    assertKnownSlotValue(flag, "globalThis 自有槽", value);
    if (own.configurable !== true) {
      throw new Error(`claimApply: flag "${flag}" 已有不可配置的自有属性`);
    }
    return { occupied: false, previous: own };
  }

  // 自有槽不存在时仍要看一眼原型链：同名访问器不能靠普通赋值去碰（那会调用 setter
  // 或让 token 落不下去），同名非协议值则是撞了别的全局属性。真正的占位仍只落在自有槽上。
  const inherited = findInheritedDescriptor(target, flag);
  if (inherited !== null) {
    if (!("value" in inherited)) {
      throw accessorSlotError(flag, "globalThis 的原型链");
    }
    assertKnownSlotValue(flag, "globalThis 的原型链", inherited.value);
  }
  return { occupied: false, previous: undefined };
}

/**
 * apply 幂等保护：已 claim 返回 false（调用方直接 return），否则占位并
 * 挂 ctx.effect 清理——HMR 重载时 flag 复位，再次 apply 可重新声明。
 *
 * 占位值是本次 claim 现造的 symbol；保护对外的判断标准是「**自有**数据槽上的 `true` 或
 * 任何 symbol」：
 * `true` 是外部可写的占位约定（判断放宽一分就重新打开 HMR 重复装载），symbol 标识让
 * 重复加载的另一份模块实例的占位同样被认出——两份实例各持各的 token，靠 typeof 而不是
 * 身份对上。清理只认**自己那个** token：旧实例的 disposer 迟于新实例 claim 执行（HMR /
 * 重复加载不保证时序，也不保证恰好调一次）时，它认不得新实例的占位，新 claim 得以保留。
 * claim 之前槽上已有的自有数据属性按原 descriptor 原样恢复；此前没有自有键则删键。
 *
 * 槽的形态是硬契约：只支持可配置的数据属性。访问器（自有或原型链上）、需要认领的
 * 不可配置自有槽、以及 `undefined`/`false`/`true`/symbol 之外的既有值都明确抛错——
 * 不静默覆盖全局属性，也不把访问器语义改成一次隐式读写。
 *
 * 兼容性：本函数认旧代码写的 `true`，也能认当前 0.2.x 写的 symbol；但**旧版内联守卫**
 * 写的是 `globalThis[flag] === true`，不认 symbol，且旧 disposer 会无条件写 undefined。
 * 因此新旧两版同页共存时 token 保护是单向的；现行宿主替换路径是先完整卸载旧 fiber 再
 * import/执行新版 apply，正常单版本路径不依赖这条兼容性。若未来出现混合版本页，需要
 * 按宿主顺序保证旧版先卸载，不能放宽这里「第二个 ctx 直接返回 false」的守卫。
 *
 * ⚠ 标记是**同一 globalThis（同一 realm）内共享**的，不是进程级、也不是 per-ctx：
 * 同一张卡被第二个 ctx apply 时会被这一个拒绝。要允许多 ctx 共存就得按 ctx 管理
 * （WeakSet 一类），别改成这里"顺手放过第二次"——那会重新打开 HMR 重复装载这条路。
 * iframe / worker / Node worker_threads 各有自己的 globalThis，不共享这份标记。
 *
 * @param ctx   - apply 的 ctx（需要 effect）。
 * @param flag  - globalThis 上的占位标记键名（如 "__xxxCardApplied"），形态见 {@link isLegalClaimFlag}。
 * @param label - effect 标签（日志/生命周期可观测）。
 * @returns true 表示本次拿到声明权（继续执行），false 表示已被占位。
 */
export function claimApply(ctx: CardApplyCtx, flag: string, label: string): boolean {
  if (!isLegalClaimFlag(flag)) {
    throw new Error(`claimApply: flag 不得为空或命中 Object.prototype：${flag}`);
  }

  const { occupied, previous } = resolveClaimSlot(globalThis, flag);
  if (occupied) {
    return false;
  }

  const token = Symbol(flag);
  const next: ClaimSlotDescriptor = {
    value: token,
    writable: previous?.writable ?? true,
    enumerable: previous?.enumerable ?? true,
    configurable: true,
  };
  try {
    // 不用 target[flag] = token：普通赋值会走原型链上的 setter，也可能被自有访问器
    // 拦下而不留下自有 token。defineProperty 明确写自有数据槽。
    Object.defineProperty(globalThis, flag, next);
  } catch (error) {
    throw new Error(`claimApply: 无法写入占位槽 "${flag}"`, { cause: error });
  }

  try {
    ctx.effect(
      () => () => {
        // 只清自己那枚：值与身份分开，旧实例迟到的 disposer 认不得新实例的 token。
        releaseClaim(globalThis, flag, token, previous);
      },
      label,
    );
  } catch (error) {
    // 挂不上 effect 就等于这次**没拿到**声明权（清理没挂成，将来无人复位）。标记必须原样退回：
    // 否则占位会一直挂着，这条 apply 从此永远返回 false，保护从"防重复"变成"禁止再挂"，
    // 而除了整页刷新没有别的补救。异常照旧上抛——调用方要看见它，且它不是本保护的责任。
    // 若回滚本身也失败（槽在 claim 后被外部改成不可配置），把两个错误一起交给调用方，
    // 不让回滚错误盖掉原始注册错误。
    try {
      releaseClaim(globalThis, flag, token, previous);
    } catch (rollbackError) {
      // 保留原始注册错误作为主错误；回滚错误挂到它的 cause 上，两个都可诊断。
      // Reflect.set 在不可扩展对象上返回 false 而不是抛出——诊断字段挂不上时也不能改抛，
      // 否则回滚失败的次生错误仍会盖掉原始注册错误。
      if (error instanceof Error && error.cause === undefined) {
        Reflect.set(error, "cause", rollbackError);
      }
    }
    throw error;
  }
  return true;
}
