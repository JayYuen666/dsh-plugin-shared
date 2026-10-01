// test/job-outcome.test.ts —— 落定进程 → 官方作业结局的映射。
//
// 这张表的价值在于它钉的是**宿主自己的 bash 工具用的那一份口径**（实测 installed
// @deepseek-ai/dsh-tool-bash/lib/index.js 的 processOutcome）：本包两个生产者
// （zvec-grep 的重建、ocr-review 的后台评审）交进同一枚注册表的结局必须与宿主的 bash
// 作业同形，否则同一个 job_list 里会出现两套说法。

import { describe, expect, it } from "vitest";
import { jobOutcomeOf } from "../lib/job-outcome.ts";
import type { SettledProcess } from "../lib/job-outcome.ts";

/**
 * 造一枚落定进程（只带本函数读的三个成员）。
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
    // 官方名册里那一行理由。
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
