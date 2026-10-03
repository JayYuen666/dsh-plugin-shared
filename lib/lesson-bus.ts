// lib/lesson-bus.ts —— 调用 lessonLoop 服务面的统一收口。
//
// 为什么需要这一份：lesson-loop 的规则库存进 settings 命名空间后，report / pass 的落库
// 是异步的（返回 Promise）。三个调用方原本都用 `try { bus.report(...) } catch { 记日志 }`
// 包住同步调用；换成异步后失败以 rejection 的形式出现，try/catch 抓不到——既把失败
// 悄悄吞掉，又给进程留一个 unhandled rejection。四处调用点各写一份 catch 会长出四种
// 不完全一样的降级口径，所以收敛成这一个函数：同步抛错与异步拒绝都交给同一个 onFailure。

// 可等待面直接用全局的 PromiseLike<unknown>，不再本地手写一份 thenable 接口：标准库那份
// 描述的就是同一件事（只认 then 方法，真 Promise 与自带 then 的替身都算），手写一份只会
// 与它漂移，还要自己维护与下面那个判别谓词的一致性。本模块只 await、从不调 .then，所以
// lib.d.ts 里 onrejected 的 any 不会渗进这里的类型面。它是模块私有的——
// dist/types/lesson-bus.d.ts 里查无此名，故对消费方零影响。

/**
 * 值是否为可等待对象。逐层收窄而不是 instanceof Promise：宿主给的 Promise 可能来自另一份
 * realm，认 then 才不会把「没接住 rejection」误判成「已处理」。
 *
 * 函数型对象也一并算 thenable：**漏判的方向是不安全的**——认错了只是多 `await` 一次，
 * 漏认了却会让一次 rejection 无人接管，直接变成进程级未处理拒绝。
 * @param value - 待判定的调用返回值。
 * @returns true 表示要给它挂一个 rejection 出口。
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  // 判据必须直接写在 value 上：把 typeof 结果存进变量不产生收窄，Reflect.get 会收到 unknown。
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

/**
 * 走一次失败收口，且不让收口自己的抛错逃出去。
 *
 * 本模块的职责就是把两类失败汇到**同一个**出口；若 `onFailure` 自己抛错时仍按原样外抛，
 * 同步路径会把异常抛给调用方、异步路径会变成未处理拒绝——两条分叉都会盖掉真正的失败原因。
 * 所以这里统一记日志后吞掉。
 * @param reason - 捕获到的失败原因。
 * @param onFailure - 调用方给的失败收口。
 */
function report(reason: unknown, onFailure: (reason: unknown) => void): void {
  try {
    onFailure(reason);
  } catch (error) {
    console.error("[shared/lesson-bus] onFailure threw:", error);
  }
}

/**
 * 等一次可等待调用落定，只把拒绝送进失败收口。
 *
 * 用 `await` 而不是 `.then(null, onFailure)`（本仓的 async/await 侧口径，见 lint 基线
 * `promise/prefer-await-to-then`）：await 自身就是一个 rejection 出口，挂上即视为已处理；
 * fulfil 侧无需动作（回执不参与调用方判定）。
 * @param thenable - 调用返回的可等待值。
 * @param onFailure - 失败收口，与同步抛错共用。
 */
async function drainRejection(
  thenable: PromiseLike<unknown>,
  onFailure: (reason: unknown) => void,
): Promise<void> {
  try {
    await thenable;
  } catch (error) {
    report(error, onFailure);
  }
}

/**
 * 执行一次 lesson bus 调用，并把两类失败归到同一个出口。
 * @param call - 真正的调用（同步返回或返回 Promise 都接受）。
 * @param onFailure - 失败收口：同步抛错与异步拒绝都会到这里，且各自只被调一次。
 */
export function settleLessonCall(call: () => unknown, onFailure: (reason: unknown) => void): void {
  try {
    const settled = call();
    if (isThenable(settled)) {
      // 出口在 drainRejection 里挂上（它自己吞掉拒绝，故这里只需 void 掉那个 Promise）。
      void drainRejection(settled, onFailure);
    }
  } catch (error) {
    report(error, onFailure);
  }
}
