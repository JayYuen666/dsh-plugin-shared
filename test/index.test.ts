// test/index.test.ts —— 入口 barrel 冒烟：根导出是留给「一次引入全部切面」的调用方
// （含外部插件作者）的，本仓消费方一律按 `@jayyuen66/dsh-plugin-shared/lib/<facet>` 子路径取；
// 某条 re-export 断了要在装载期就炸出来，而不是等运行时 "xxx is not a function"。

import { describe, expect, it } from "vitest";
import {
  claimApply,
  deriveProjectKey,
  diffTouched,
  editPathOf,
  errorText,
  fieldOf,
  hasMethods,
  isRecord,
  isSettingsConflict,
  jobOutcomeOf,
  killProc,
  messagesFor,
  parseToolArguments,
  resolveLocale,
  scanToolEvents,
  settleLessonCall,
  shrinkJsonlTail,
  toolArgumentsBad,
  truncateEnd,
  truncateStart,
} from "../lib/index.ts";

describe("lib/index 聚合导出", () => {
  it("根 barrel 把每一面的公开成员都作为函数导出（面数不写死：新增切面就该在这里被看到）", () => {
    for (const fn of [
      parseToolArguments,
      toolArgumentsBad,
      scanToolEvents,
      editPathOf,
      claimApply,
      deriveProjectKey,
      messagesFor,
      resolveLocale,
      settleLessonCall,
      truncateEnd,
      truncateStart,
      isRecord,
      fieldOf,
      errorText,
      shrinkJsonlTail,
      jobOutcomeOf,
      killProc,
      diffTouched,
      hasMethods,
      isSettingsConflict,
    ]) {
      expect(fn).toBeTypeOf("function");
    }
  });
});
