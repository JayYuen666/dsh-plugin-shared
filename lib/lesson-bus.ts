// lib/lesson-bus.ts —— 调用 lessonLoop 服务面的统一收口。
//
// 为什么需要这一份：lesson-loop 的规则库存进 settings 命名空间后，report / pass 的落库
// 是异步的（返回 Promise）。三个调用方原本都用 `try { bus.report(...) } catch { 记日志 }`
// 包住同步调用；换成异步后失败以 rejection 的形式出现，try/catch 抓不到——既把失败
// 悄悄吞掉，又给进程留一个 unhandled rejection。四处调用点各写一份 catch 会长出四种
// 不完全一样的降级口径，所以收敛成这一个函数：同步抛错与异步拒绝都交给同一个 onFailure。

/** 只认 then 方法的最小可等待形状：真 Promise 与自带 then 的替身都算。 */
interface ThenableLike {
  then: (
    onFulfilled?: ((value: unknown) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ) => unknown;
}

/**
 * 值是否为可等待对象。逐层收窄而不是 instanceof Promise：宿主给的 Promise 可能来自另一份
 * realm，认 then 才不会把「没接住 rejection」误判成「已处理」。刻意不认函数型 thenable——
 * 本仓唯一的 provider 是设置服务，它给的是真 Promise，不额外养一条走不到的分支。
 * @param value - 待判定的调用返回值。
 * @returns true 表示要给它挂一个 rejection 出口。
 */
function isThenable(value: unknown): value is ThenableLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
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
  thenable: ThenableLike,
  onFailure: (reason: unknown) => void,
): Promise<void> {
  try {
    await thenable;
  } catch (error) {
    onFailure(error);
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
    onFailure(error);
  }
}
