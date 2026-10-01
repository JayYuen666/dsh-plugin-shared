// lib/job-outcome.ts —— 把落定的子进程映射成官方作业注册表的结局（ctx.jobs 的 JobOutcome）。
//
// 收录依据：F3 换装后本仓有两个生产者（zvec-grep 的后台重建、ocr-review 的后台评审），
// 两处逐字同构即满足 README「两处以上逐字同构才收敛」。**这条依据要打折说清**：两枚生产者
// 是同一次波次里新写的，"两处同构"因此是自证而非既存重复（第 1 轮复核 B-m7）。留着它的
// 真实理由是另一条：两包都调、且口径必须一致，散着写两份就会漂。
//
// 口径的来源是宿主 bash 工具的 `processOutcome`（installed
// @deepseek-ai/dsh-tool-bash/lib/index.js:42-54）——被信号终止才算 killed，**任何自然退出
// 都是 completed**（含 exit 127「命令根本没装」），退出码/信号名进 detail。但那是个
// **模块私有函数**：不导出、无契约。所以"同一枚注册表里本包的作业与宿主 bash 作业长得一样"
// 只是**当下**成立：宿主哪天改措辞（`exit code: 0` → `exited with 0`）本仓不会红，
// 本包的测试断的是抄下来的字面量，不是"与宿主一致"这件事本身。也就是说这句声称降级为
// **本包自己的显示口径**；真要钉住一致性，得把宿主那个函数台架化（像 plugins/docs/harness/f3-equiv/probe-jobs.mjs
// 那样按行为跑），本轮未做。
//
// 两件事刻意**不**放进这里，各自的理由写在调用点：
//  - **不带 kill reason**：注册表在 killed 时把 `kill(id, undefined, reason)` 的那个
//    reason 追加进 detail（实测 `signal: SIGTERM; 用户取消`），生产者再带一遍就是同一句
//    写两遍；
//  - **不拼沙箱事实**：zvec-grep 把它拼进自家卡片视图（要随语言走），ocr-review 走会话
//    记录——合并即改行为，与本包「只收逐字同构」的口径不符。

import type { ShellProcess } from "@deepseek-ai/dsh-shell";
import type { JobOutcome } from "@deepseek-ai/dsh-jobs";

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
  return { status: "completed", detail: `exit code: ${String(proc.exitCode ?? 0)}` };
}
