// test/tool-events.test.ts —— tool 事件流记账骨架单测。
// 契约与 quality-gate collectEdits / danger-guard scanToolCalls+resolveResultLedger
// 对齐（callId 串联、arguments 双形态、view 只读语义）。
//
// 事件一律经 ./fixtures/events.ts 的构造器产出：生产面绑官方 SessionEvent 后，信封必填
// 位与 ToolCallId/MessageId/SessionSeq 品牌都得补齐。类型面不可表示的畸形形状（缺 callId、
// 缺 subCallId、retired 的 content[0].isError……）显式走 badEvent()——那是用例明说的意图。

import { describe, expect, it } from "vitest";
import {
  scanToolEvents,
  parseToolArguments,
  editPathOf,
  toolEventRowsOf,
} from "../lib/tool-events.ts";
import type { SessionEvent, ToolCallRecord } from "../lib/tool-events.ts";
import {
  badEvent,
  call,
  ptcCall,
  ptcSettle,
  unrelated,
  resetSeq,
  result,
} from "./fixtures/events.ts";

/** 坏事件构造点要显式写出的事件类型（畸形只出在 data 上，type 保持合法以证明是 data 的锅）。 */
const PTC_DISPATCH_TYPE = "tool/ptc-dispatch";
const RESULT_TYPE = "tool/result";

/** 结算事件 → 该事件的 isError；不产出结算行时返回 undefined。 */
function isErrorOf(event: SessionEvent): boolean | undefined {
  return toolEventRowsOf(event, 0).result?.isError;
}

describe("parseToolArguments", () => {
  it("string JSON 解析；非法字符串回空对象", () => {
    expect(parseToolArguments('{"a":1}')).toStrictEqual({ a: 1 });
    expect(parseToolArguments("{bad")).toStrictEqual({});
    expect(parseToolArguments("42")).toStrictEqual({});
  });

  it("对象直用；null/undefined/数组/数字回空对象", () => {
    expect(parseToolArguments({ a: 1 })).toStrictEqual({ a: 1 });
    expect(parseToolArguments(null)).toStrictEqual({});
    expect(parseToolArguments(undefined)).toStrictEqual({});
    expect(parseToolArguments([1, 2])).toStrictEqual({});
    expect(parseToolArguments(7)).toStrictEqual({});
  });
});

describe("scanToolEvents", () => {
  it("提取 tool/call 与 tool/result 两张表（含 seq、callId 串联）", () => {
    resetSeq();
    const events = [
      unrelated(),
      call("c1", "edit", '{"file_path":"/a.ts"}'),
      result("c1"),
      call("c2", "grep", '{"pattern":"x"}'),
      result("c2", true),
    ];
    const { calls, results } = scanToolEvents(events);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ name: "edit", callId: "c1", seq: 1 });
    expect(calls[0]?.arguments).toStrictEqual({ file_path: "/a.ts" });
    expect(calls[1]).toMatchObject({ name: "grep", callId: "c2", seq: 3 });
    expect(calls[1]?.arguments).toStrictEqual({ pattern: "x" });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ callId: "c1", isError: false, seq: 2 });
    expect(results[1]).toMatchObject({ callId: "c2", isError: true, seq: 4 });
  });

  it("形状不合规的事件静默跳过", () => {
    resetSeq();
    // 只测「type 齐但 data 不可用 / 类型不认识」两类；数组空洞（undefined 元素）在
    // 下面的「坏事件容忍」里单独钉，那儿本就要造稀疏数组。
    const events = [
      badEvent({ type: "tool/call" }),
      badEvent({ type: "weird/type", data: { name: "x" } }),
    ];
    const { calls, results } = scanToolEvents(events);
    expect(calls).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  it("无 callId 的 tool/call 保留 undefined（调用方造 nc: 键）", () => {
    resetSeq();
    // 官方 `tool/call.callId` 必选，故这条坏契约只能经 badEvent 表达。
    const { calls } = scanToolEvents([
      badEvent({
        type: "tool/call",
        data: { turn: 1, step: 1, name: "edit", arguments: '{"file_path":"/b.ts"}' },
      }),
    ]);
    expect(calls[0]?.callId).toBeUndefined();
    expect(calls[0]?.seq).toBe(0);
  });

  it("badArguments 仅标 JSON 语法非法（合法 JSON 非对象与非字符串不标，对齐 qvg EDIT_SKIP 语义）", () => {
    resetSeq();
    const { calls } = scanToolEvents([
      call("b1", "edit", "{bad"),
      // 合法 JSON 非对象 → 不标
      call("b2", "edit", "42"),
      // 非字符串（官方 tool/call.arguments 必为模型产出的 raw JSON 串）→ 不标
      badEvent({ type: "tool/call", data: { turn: 1, step: 1, name: "edit", arguments: 42 } }),
      call("b3", "edit", '{"file_path":"/ok.ts"}'),
    ]);
    expect(calls.map((row) => row.badArguments)).toStrictEqual([true, false, false, false]);
  });

  it("识别 PTC 子调度事件：tool/ptc-dispatch-start → call、tool/ptc-dispatch → result（subCallId 配对）", () => {
    resetSeq();
    const events = [
      unrelated(),
      // run_code 内子调用：read 成功（arguments 官方即派发前归一化后的对象，非 JSON 串）
      ptcCall("rc1:ptc:1", "read", { file_path: "/a.ts" }),
      ptcSettle("rc1:ptc:1", "read", false),
      // grep 失败：isError 在 data 顶层（非 message 内嵌）
      ptcCall("rc1:ptc:2", "grep", { pattern: "x", path: "/" }),
      ptcSettle("rc1:ptc:2", "grep", true),
    ];
    const { calls, results } = scanToolEvents(events);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ name: "read", callId: "rc1:ptc:1", seq: 1 });
    expect(calls[0]?.arguments).toStrictEqual({ file_path: "/a.ts" });
    expect(calls[1]).toMatchObject({ name: "grep", callId: "rc1:ptc:2", seq: 3 });
    expect(calls[1]?.arguments).toStrictEqual({ pattern: "x", path: "/" });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ callId: "rc1:ptc:1", isError: false, seq: 2 });
    expect(results[1]).toMatchObject({ callId: "rc1:ptc:2", isError: true, seq: 4 });
  });

  it("PTC 事件缺 subCallId 视为坏事件跳过（不造 nc: 保守成功假证据）", () => {
    resetSeq();
    const { calls, results } = scanToolEvents([
      badEvent({
        type: "tool/ptc-dispatch-start",
        data: { name: "read", arguments: { file_path: "/a.ts" } },
      }),
      badEvent({
        type: PTC_DISPATCH_TYPE,
        data: { name: "read", arguments: { file_path: "/a.ts" }, isError: false },
      }),
    ]);
    expect(calls).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  it("PTC dispatch 缺 isError 按成功计（与 tool/result 无内容按成功同方向）", () => {
    resetSeq();
    const { results } = scanToolEvents([
      badEvent({ type: PTC_DISPATCH_TYPE, data: { subCallId: "rc1:ptc:1", name: "read" } }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ callId: "rc1:ptc:1", isError: false });
  });
});

describe("成败位读取（经 toolEventRowsOf 这条公开面）", () => {
  it("message.isError===true 判失败；false/缺失按成功（v4 message 级）", () => {
    resetSeq();
    expect(isErrorOf(result("r1", true))).toBe(true);
    expect(isErrorOf(result("r2", false))).toBe(false);
    expect(isErrorOf(badEvent({ type: RESULT_TYPE, data: { message: {} } }))).toBe(false);
  });

  it("非 tool/result 事件不产出结算行（PTC 的成败位在 data 顶层，由它自己的分支读）", () => {
    resetSeq();
    expect(
      isErrorOf(badEvent({ type: PTC_DISPATCH_TYPE, data: { isError: true } })),
    ).toBeUndefined();
  });

  it("retired 形状（块级 content[0].isError）不再被读：按成功计", () => {
    resetSeq();
    // 成败位曾放在 message.content[0]，v4 上移到 message 级。
    // 本模块只认 v4 位置、不做 content[] 兜底——若宿主仍发旧形状，这里就是
    // fail-open 的显式指纹：isError:true 也判成功。改回兜底会让本断言变红。
    const retired = badEvent({
      type: RESULT_TYPE,
      data: { message: { content: [{ isError: true }] } },
    });
    expect(isErrorOf(retired)).toBe(false);
  });
});

describe("editPathOf", () => {
  it("str_replace_editor view 视为只读（write 判定旁路）", () => {
    const viewCall: ToolCallRecord = {
      name: "str_replace_editor",
      callId: "x",
      seq: 0,
      arguments: { command: "view", path: "/v.ts" },
      badArguments: false,
    };
    expect(editPathOf(viewCall)).toStrictEqual({ kind: "read-view", path: "/v.ts" });
  });

  it("str_replace_editor 写操作取 path", () => {
    expect(
      editPathOf({
        name: "str_replace_editor",
        callId: "x",
        seq: 0,
        arguments: { command: "str_replace", path: "/w.ts" },
        badArguments: false,
      }),
    ).toStrictEqual({ kind: "write", path: "/w.ts" });
  });

  it("edit/write 取 file_path", () => {
    for (const name of ["edit", "write"]) {
      expect(
        editPathOf({
          name,
          callId: "x",
          seq: 0,
          arguments: { file_path: "/f.ts" },
          badArguments: false,
        }),
      ).toStrictEqual({ kind: "write", path: "/f.ts" });
    }
  });

  it("无路径 → path undefined（kind 仍 write，调用方过滤）", () => {
    expect(
      editPathOf({ name: "edit", callId: "x", seq: 0, arguments: {}, badArguments: false }),
    ).toStrictEqual({ kind: "write", path: undefined });
  });
});

describe("scanToolEvents 坏事件容忍", () => {
  it("数组空洞 / 无 data / 无 type 一律静默跳过（不抛，交给调用方空表降级）", () => {
    resetSeq();
    const sparse: SessionEvent[] = [];
    sparse[2] = call("c9", "edit", "{}");
    const { calls, results } = scanToolEvents([
      ...sparse,
      badEvent({ type: "no-data" }),
      badEvent({ data: { name: "edit" } }),
    ]);
    expect(calls).toHaveLength(1);
    // seq 取入参下标：空洞占位仍计，保证归因游标与事件流一致。
    expect(calls[0]?.seq).toBe(2);
    expect(results).toStrictEqual([]);
  });

  it("数组里的 null 元素同样静默跳过（官方元素记为非可空，只有坏数据才有）", () => {
    resetSeq();
    // 曾按 `event?.data` 读，改写为判别联合时丢了这层：null 会在读 .data 时抛 TypeError，
    // 把「零星坏事件不抛错」的契约打断在门禁热路径上。此用例钉住它。
    const withNull = [
      null,
      call("n1", "edit", '{"file_path":"/n.ts"}'),
    ] as unknown as SessionEvent[];
    const { calls } = scanToolEvents(withNull);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.callId).toBe("n1");
    expect(calls[0]?.seq).toBe(1);
  });

  it("tool/result 缺 message / source / callId 非字符串 → callId undefined（不串联，按未结算）", () => {
    resetSeq();
    const { results } = scanToolEvents([
      badEvent({ type: RESULT_TYPE, data: {} }),
      badEvent({ type: RESULT_TYPE, data: { message: {} } }),
      badEvent({ type: RESULT_TYPE, data: { message: { source: { callId: "c" } } } }),
    ]);
    expect(results.map((row) => row.callId)).toStrictEqual([undefined, undefined, "c"]);
    expect(results.every((row) => !row.isError)).toBe(true);
  });

  it("callId 非字符串（坏契约）→ 归 undefined，不冒充真实串联键", () => {
    resetSeq();
    const { calls, results } = scanToolEvents([
      badEvent({ type: RESULT_TYPE, data: { message: { source: { callId: 7 } } } }),
      badEvent({
        type: "tool/call",
        data: { turn: 1, step: 1, name: "edit", arguments: {}, callId: 5 },
      }),
    ]);
    expect(calls[0]?.callId).toBeUndefined();
    expect(results[0]?.callId).toBeUndefined();
  });
});
