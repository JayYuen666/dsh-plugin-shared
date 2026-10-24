// lib/job-outcome.ts —— 把落定的子进程映射成官方作业注册表的结局（ctx.jobs 的 JobOutcome）。
//
// 为什么收进来：本仓有两个生产者（后台重建、后台评审），两处逐字同构即满足 README 的收录判据；
// 更硬的那条理由是两包都调、且口径必须一致，散着写两份就会漂。
//
// 口径的来源是宿主 bash 工具的 `processOutcome`（`@deepseek-ai/dsh-tool-bash`）——被信号终止
// 才算 killed，**任何自然退出都是 completed**（含 exit 127「命令根本没装」），退出码/信号名进
// detail。
//
// 为什么不能直接用它：**不可达，不是不存在**。它是 `export function processOutcome`、带完整
// JSDoc（packages/shell/tool-bash/src/background.ts:44），但那个包的 exports 只开根入口、files
// 只带 lib/index.js：`./background` 子路径没进 export map，src/ 也不随包发布，所以插件侧
// import 不到，走根入口也取不到这个符号。
//
// 耦合比原先记的更紧：killed 的两条 detail 文案与 completed 的那一条，都是**逐字相同**抄下来的。
// 所以"同一枚注册表里本包的作业与宿主 bash 作业长得一样"只在当下成立：宿主哪天改措辞
//（`exit code: 0` → `exited with 0`）本仓不会红，本包的测试断的是抄下来的字面量，而不是
// "与宿主一致"这件事本身。也就是说这句声称降级为**本包自己的显示口径**；真要钉住一致性，
// 得把宿主那个函数按行为跑一遍台架，或者推动上游把子路径进 export map。
//
// 两件事刻意**不**放进这里，各自的理由写在调用点：
//  - **不带 kill reason**：注册表在 killed 时把 `kill(id, undefined, reason)` 的那个
//    reason 追加进 detail，生产者再带一遍就是同一句写两遍；
//  - **不拼沙箱事实**：两个消费包的文案面不同（一处随界面语言走、一处进会话记录），
//    合并即改行为，与本包「只收逐字同构」的口径不符。

import type { ShellProcess } from "@deepseek-ai/dsh-shell";
import type { JobOutcome } from "@deepseek-ai/dsh-jobs";

/** thenable 判据：`kill()` 的返回值只会被丢弃或被收掉，不需要 Promise 的其余面。 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  // 判据必须直接写在 value 上：把 typeof 结果存进变量不产生收窄，Reflect.get 会收到 unknown。
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

/**
 * 把 `kill()` 返回的 Promise 的拒绝收掉。单独成函数是因为 `killProc` 自己必须同步返回：
 * 写成 `async` 会让调用点拿到一个没人 await 的 Promise，问题只是换了条路逃出去。
 * @param settled `kill()` 的返回值
 */
async function drainFailure(settled: PromiseLike<unknown>): Promise<void> {
  try {
    await settled;
  } catch {
    // 忽略：见 killProc 的 JSDoc
  }
}

/**
 * 官方结局类型在这里再出一个具名出口。`jobOutcomeOf` 的返回类型就是它，消费方把它写进自己的
 * 签名（生产者回调、测试断言）时若没有具名出口，只能把结构重述一遍——而重述正是本包要收敛掉的。
 */
export type { JobOutcome } from "@deepseek-ai/dsh-jobs";

/** 映射只用得到的三个成员（不是整个 ShellProcess：生产者句柄的其余面与本函数无关）。 */
export type SettledProcess = Pick<ShellProcess, "status" | "exitCode" | "signal">;

/**
 * 落定进程 → 作业结局。
 * @param proc 已落定的子进程句柄（`done` 已 resolve 之后再读，值才是终态）
 * @returns 交给 {@link JobRegistry} 生产者的结局：killed / completed，理由在 detail
 */
export function jobOutcomeOf(proc: SettledProcess): JobOutcome {
  if (proc.status === "killed") {
    // signal 是官方 d.ts 的 `NodeJS.Signals | null`（自然退出为 null），所以判 null 即穷尽。
    return {
      status: "killed",
      detail: proc.signal === null ? "killed before exit" : `signal: ${proc.signal}`,
    };
  }
  // `exitCode === null` 只在「被信号终止」或「还在跑」时出现；走到这一支说明 status 是
  // completed，故按宿主的 `processOutcome` 口径记 0（宿主对「跑完了但没报退出码」同样记 0）。
  // 卡片侧不受影响：消费方投影时直接读 `proc.exitCode` 原样下发，这里只决定名册里那行理由。
  return { status: "completed", detail: `exit code: ${String(proc.exitCode ?? 0)}` };
}

/**
 * 只用得到的那一个成员。**不按 `ShellProcess` 整型收**：官方的 `kill` 返回 `Promise<boolean>`，
 * 把那个返回类型写进签名等于要求每个调用方（含测试替身）都得交回一个 Promise，
 * 而这里真正需要的只是「有一个可以试着调的 kill」——返回值要么被丢弃，要么被收掉拒绝。
 */
export interface KillableProcess {
  kill: () => unknown;
}

/**
 * 收掉子进程，**忽略失败**：进程可能已自然退出或已被系统回收，此时 kill 失败不是本包的失败。
 *
 * 为什么不向调用方通报：调用点都在清理臂（卸载、被拒、超时）上，那里没有可行动的下一步；
 * 把异常抛出去只会让清理链半途而废，留下更难的现场。
 *
 * 同步抛错与**异步拒绝**都要收：官方句柄的 `kill` 返回 `Promise<boolean>`，同步 try/catch
 * 只拦得住前者，返回的 Promise 拒绝会一路逃到进程级 unhandledRejection——清理臂不该有能力
 * 把宿主进程的未处理拒绝计数器推高。
 * @param proc 待收的句柄
 */
export function killProc(proc: KillableProcess): void {
  try {
    const settled = proc.kill();
    if (isThenable(settled)) {
      // 出口在这个 Promise 自己身上：await 一下就把它标记为已处理。拒绝内容不进日志——
      // 清理臂的失败没有可行动的下一步，记下来只会污染宿主输出。
      void drainFailure(settled);
    }
  } catch {
    // 忽略
  }
}
