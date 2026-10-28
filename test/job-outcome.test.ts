// test/job-outcome.test.ts —— 已结束进程 → 官方作业结局的映射。
//
// 这张表的价值在于它固定的是**宿主自己的 bash 工具用的那一份行为**（实测 installed
// @deepseek-ai/dsh-tool-bash/lib/index.js 的 processOutcome）：本包两个生产者
// （zvec-grep 的重建、ocr-review 的后台评审）交进同一个注册表的结局必须与宿主的 bash
// 作业同形，否则同一个 job_list 里会出现两套说法。

import { setImmediate as yieldToMacrotask } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { jobOutcomeOf, killProc } from "../lib/job-outcome.ts";
import type { SettledProcess } from "../lib/job-outcome.ts";

/**
 * 造一个已结束进程（只带本函数读的三个成员）。
 * @param over 覆盖默认值的字段
 * @returns {SettledProcess}
 */
function settled(over: Partial<SettledProcess> = {}): SettledProcess {
  return { status: "completed", exitCode: 0, signal: null, ...over };
}

describe("jobOutcomeOf", () => {
  it("自然退出一律 completed，退出码原样进 detail（含非零）", () => {
    // bash-local 对 exit 127「命令根本没装」也给 completed：把非零说成 failed 会让
    // 观察者以为执行器坏了，而它其实跑完了。
    expect(jobOutcomeOf(settled({ exitCode: 127 }))).toStrictEqual({
      status: "completed",
      detail: "exit code: 127",
    });
    expect(jobOutcomeOf(settled()).detail).toBe("exit code: 0");
  });

  it("completed 但没报退出码 ⇒ 按 0 记账（与宿主 bash 同口径）", () => {
    // 卡片侧不受影响：zvec-grep 的投影直接读 proc.exitCode 原样下发，这里只影响
    // 官方作业列表里那一行理由。
    expect(jobOutcomeOf(settled({ exitCode: null })).detail).toBe("exit code: 0");
  });

  it("信号终止 ⇒ killed，detail 给信号名", () => {
    expect(
      jobOutcomeOf(settled({ status: "killed", exitCode: null, signal: "SIGTERM" })),
    ).toStrictEqual({
      status: "killed",
      detail: "signal: SIGTERM",
    });
  });

  it("killed 但执行器没给信号名 ⇒ 明说「退出前就被终止」，不凭空造退出码", () => {
    expect(jobOutcomeOf(settled({ status: "killed", exitCode: null, signal: null })).detail).toBe(
      "killed before exit",
    );
  });

  it("生产者只交 completed/killed 两态：failed 是注册表自己的判定，不由映射产生", () => {
    for (const proc of [settled(), settled({ exitCode: 3 }), settled({ status: "killed" })]) {
      expect(["completed", "killed"]).toContain(jobOutcomeOf(proc).status);
    }
  });

  it("不带 reason、不带 result：那是注册表与流的事，重复带就是把同一句写两遍", () => {
    const outcome = jobOutcomeOf(settled({ status: "killed", exitCode: null, signal: "SIGKILL" }));
    expect(Object.keys(outcome).toSorted()).toStrictEqual(["detail", "status"]);
    expect(outcome.detail).not.toMatch(/cancel|用户取消/u);
  });
});

describe("killProc（清理臂的收进程）", () => {
  it("把 kill 转给句柄", () => {
    const calls: number[] = [];
    killProc({
      kill: () => {
        calls.push(1);
      },
    });
    expect(calls).toStrictEqual([1]);
  });

  it("句柄已回收时 kill 自己抛错也不向清理臂通报", () => {
    expect(() => {
      killProc({
        kill: () => {
          throw new Error("already reaped");
        },
      });
    }).not.toThrow();
  });

  it("kill 返回被拒绝的 Promise 时不留未处理拒绝", async () => {
    // 官方句柄的 kill 是 `() => Promise<boolean>`：同步 try/catch 拦不住异步拒绝，
    // 那条 rejection 最终会变成进程级 unhandledRejection。清理分支不该有这种能力。
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      killProc({ kill: () => Promise.reject(new Error("kill boom")) });
      // 必须让出一个**宏任务**：未处理拒绝是在 microtask 队列排空之后的检查点才上报的，
      // 只 await 几次 Promise.resolve() 时 old/new 两种实现都收不到事件（此用例会假装通过）。
      await yieldToMacrotask();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toStrictEqual([]);
  });
});
