// test/index.test.ts —— 入口 barrel 冒烟：根导出是留给「一次引入全部切面」的调用方
// （含外部插件作者）的，本仓消费方一律按 `@jayyuen66/dsh-plugin-shared/lib/<facet>` 子路径取；
// 某条 re-export 断了要在装载期就炸出来，而不是等运行时 "xxx is not a function"。

import { describe, expect, it } from "vitest";
import {
  checkCsrf,
  claimApply,
  deriveProjectKey,
  editPathOf,
  errorText,
  fieldOf,
  guardBody,
  isCrossOrigin,
  isRecord,
  jobOutcomeOf,
  messagesFor,
  shrinkJsonlTail,
  parseToolArguments,
  resolveLocale,
  queryParam,
  readBody,
  requestTrust,
  guardTrust,
  trustRejectionText,
  scanToolEvents,
  sendJson,
  settleLessonCall,
  toolArgumentsBad,
  truncateEnd,
  truncateStart,
} from "../lib/index.ts";

describe("lib/index 聚合导出", () => {
  it("http / tool-events / card-apply / project-key / locale / lesson-bus / text / record / errors / jsonl / trust / job-outcome 十二面的公开成员都是函数", () => {
    for (const fn of [
      sendJson,
      isCrossOrigin,
      queryParam,
      checkCsrf,
      readBody,
      guardBody,
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
      requestTrust,
      guardTrust,
      trustRejectionText,
      jobOutcomeOf,
    ]) {
      expect(fn).toBeTypeOf("function");
    }
  });
});
