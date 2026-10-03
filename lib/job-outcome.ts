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
  return { status: "completed", detail: `exit code: ${String(proc.exitCode ?? 0)}` };
}
