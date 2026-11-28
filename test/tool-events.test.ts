// test/tool-events.test.ts —— tool 事件流记录单测。
// 约定与 quality-gate collectEdits / danger-guard scanToolCalls+resolveResultLedger
// 对齐（callId 串联、arguments 双形态、view 只读语义）。
//
// 事件一律经 ./fixtures/events.ts 的构造器产出：生产代码绑官方 SessionEvent 后，事件必填
// 位与 ToolCallId/MessageId/SessionSeq 这些官方标识类型都得补齐。类型声明里不可表示的畸形形状（缺 callId、
// 缺 subCallId、retired 的 content[0].isError……）显式走 badEvent()——那是用例明说的意图。

import { describe, expect, it } from "vitest";
import {
  scanToolEvents,
  applyPatchTargetsOf,
  editPathOf,
  editPathsOf,
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
/** PTC 子调用开始：同样走坏事件构造，故与结算一并列出。 */
const PTC_START_TYPE = "tool/ptc-dispatch-start";
const RESULT_TYPE = "tool/result";
/** 同上的 tool/call 字面量（坏事件构造点要用它，事件类型本身保持合法以证明是 data 的锅）。 */
const CALL_TYPE = "tool/call";

/** apply_patch 的调用记录；不依赖任何 describe 状态，放在外层避免每次用例重建。 */
const applyPatchCall = (input: string): ToolCallRecord => ({
  name: "apply_patch",
  callId: "x",
  seq: 0,
  arguments: { input },
  badArguments: false,
});

/** 结算事件 → 该事件的 isError；不产出结算行时返回 undefined。 */
function isErrorOf(event: SessionEvent): boolean | undefined {
  return toolEventRowsOf(event, 0).result?.isError;
}

/** 经公开的增量折叠入口读一次 tool/call 的 arguments（只有原始 JSON 文本会走 JSON.parse）。 */
function callArgsOf(
  raw: unknown,
): { arguments: Readonly<Record<string, unknown>>; badArguments: boolean } | undefined {
  const row = toolEventRowsOf(
    badEvent({ type: CALL_TYPE, data: { turn: 1, step: 1, name: "edit", arguments: raw } }),
    0,
  ).call;
  return row === undefined
    ? undefined
    : { arguments: row.arguments, badArguments: row.badArguments };
}

/** 经公开的增量折叠入口读一次 PTC 的 arguments（官方已归一化，不再 JSON.parse）。 */
function ptcArgsOf(
  raw: unknown,
): { arguments: Readonly<Record<string, unknown>>; badArguments: boolean } | undefined {
  const row = toolEventRowsOf(ptcCall("sub-args", "edit", raw), 0).call;
  return row === undefined
    ? undefined
    : { arguments: row.arguments, badArguments: row.badArguments };
}

describe("arguments 归一（经 toolEventRowsOf 这条公开接口）", () => {
  it("tool/call 的 string JSON 解析；非法字符串回空对象并标记为无效参数", () => {
    expect(callArgsOf('{"a":1}')).toStrictEqual({ arguments: { a: 1 }, badArguments: false });
    expect(callArgsOf("{bad")).toStrictEqual({ arguments: {}, badArguments: true });
    expect(callArgsOf("42")).toStrictEqual({ arguments: {}, badArguments: false });
  });

  it("tool/call 的对象做深快照并逐层冻结；null/undefined/数组/数字回空对象但不标无效参数", () => {
    const raw = { nested: { a: 1 }, list: [1, 2], nil: null };
    const view = callArgsOf(raw);
    expect(view).toStrictEqual({
      arguments: { nested: { a: 1 }, list: [1, 2], nil: null },
      badArguments: false,
    });
    // 深快照：记录不别名事件里的原对象，任何一层都改不动。
    expect(view?.arguments).not.toBe(raw);
    expect(view?.arguments["nested"]).not.toBe(raw.nested);
    expect(view?.arguments["list"]).not.toBe(raw.list);
    expect(Object.isFrozen(view?.arguments)).toBe(true);
    expect(Object.isFrozen(view?.arguments["nested"])).toBe(true);
    expect(Object.isFrozen(view?.arguments["list"])).toBe(true);
    raw.nested.a = 2;
    raw.list.push(3);
    expect(view?.arguments).toStrictEqual({ nested: { a: 1 }, list: [1, 2], nil: null });
    expect(callArgsOf(null)).toStrictEqual({ arguments: {}, badArguments: false });
    expect(callArgsOf(undefined)).toStrictEqual({ arguments: {}, badArguments: false });
    expect(callArgsOf([1, 2])).toStrictEqual({ arguments: {}, badArguments: false });
    expect(callArgsOf(7)).toStrictEqual({ arguments: {}, badArguments: false });
    // 根是 Date 而非参数映射：与对象/数组/数字一样回空，不把 Date 当 key-value 容器。
    expect(callArgsOf(new Date(0))).toStrictEqual({ arguments: {}, badArguments: false });
  });

  it("深快照保留自有 __proto__ 键，不污染快照原型", () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const view = callArgsOf(raw);
    const descriptor = Object.getOwnPropertyDescriptor(view?.arguments ?? {}, "__proto__");
    expect(descriptor?.value).toStrictEqual({ polluted: true });
    expect(Object.getPrototypeOf(view?.arguments)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("无原型对象按普通参数快照，结果仍是普通对象", () => {
    const raw = Object.create(null) as Record<string, unknown>;
    raw["a"] = 1;
    const view = callArgsOf(raw);
    expect(view).toStrictEqual({ arguments: { a: 1 }, badArguments: false });
    expect(Object.getPrototypeOf(view?.arguments)).toBe(Object.prototype);
  });

  it("原型读取抛错的参数按空对象处理，不把异常带进证据链", () => {
    const raw = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("prototype trap");
        },
      },
    );
    expect(callArgsOf(raw)).toStrictEqual({ arguments: {}, badArguments: false });
  });

  it("非 JSON 值 Date / Map 由 structuredClone 隔离；冻结只覆盖 JSON 对象/数组", () => {
    const date = new Date(0);
    const map = new Map<string, { value: number }>([["a", { value: 1 }]]);
    const view = callArgsOf({ date, map });
    const clonedDate = view?.arguments["date"];
    const clonedMap = view?.arguments["map"];
    expect(clonedDate).toBeInstanceOf(Date);
    expect(clonedDate).not.toBe(date);
    expect((clonedDate as Date).getTime()).toBe(0);
    expect(clonedMap).toBeInstanceOf(Map);
    expect(clonedMap).not.toBe(map);
    const entry = (clonedMap as Map<string, { value: number }>).get("a");
    expect(entry).toStrictEqual({ value: 1 });
    expect(entry).not.toBe(map.get("a"));
    expect(Object.isFrozen(view?.arguments)).toBe(true);
  });

  it("稀疏数组的空洞在深快照里保持空洞，不填成 undefined", () => {
    const list: unknown[] = [];
    list.length = 3;
    list[1] = { a: 1 };
    const view = callArgsOf({ list });
    const snapshot = view?.arguments["list"] as readonly unknown[];
    expect(snapshot).toHaveLength(3);
    expect(0 in snapshot).toBe(false);
    expect(1 in snapshot).toBe(true);
    expect(2 in snapshot).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("不可结构化克隆的参数按空对象处理，不把异常抛进证据链", () => {
    expect(callArgsOf({ fn: () => 1 })).toStrictEqual({ arguments: {}, badArguments: false });
  });

  it("数组循环保留环并冻结，不递归爆栈", () => {
    const list: unknown[] = [];
    list.push(list);
    const view = callArgsOf({ list });
    const snapshot = view?.arguments["list"];
    expect(Array.isArray(snapshot)).toBe(true);
    expect((snapshot as readonly unknown[])[0]).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("循环参数不会递归爆栈，深快照保留环并冻结", () => {
    const raw: Record<string, unknown> = {};
    raw["self"] = raw;
    const view = callArgsOf(raw);
    expect(view?.arguments["self"]).toBe(view?.arguments);
    expect(Object.isFrozen(view?.arguments)).toBe(true);
  });

  it("PTC 的 arguments 是已归一化值：对象深快照，字符串不二次解析、也不标语法错", () => {
    const raw = { nested: { a: 1 } };
    const view = ptcArgsOf(raw);
    expect(view).toStrictEqual({ arguments: { nested: { a: 1 } }, badArguments: false });
    expect(view?.arguments).not.toBe(raw);
    expect(view?.arguments["nested"]).not.toBe(raw.nested);
    expect(Object.isFrozen(view?.arguments["nested"])).toBe(true);
    // 同一个 JS 字符串在 tool/call 是 JSON 文本、在 PTC 是合法字符串值：不能再 parse。
    expect(ptcArgsOf('{"file_path":"a.ts"}')).toStrictEqual({
      arguments: {},
      badArguments: false,
    });
    expect(ptcArgsOf("hello")).toStrictEqual({ arguments: {}, badArguments: false });
    expect(ptcArgsOf(null)).toStrictEqual({ arguments: {}, badArguments: false });
    expect(ptcArgsOf([1, 2])).toStrictEqual({ arguments: {}, badArguments: false });
    expect(ptcArgsOf(7)).toStrictEqual({ arguments: {}, badArguments: false });
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
    // 下面的「坏事件容忍」里单独固定，那里本就要造稀疏数组。
    const events = [
      badEvent({ type: "tool/call" }),
      badEvent({ type: "weird/type", data: { name: "x" } }),
    ];
    const { calls, results } = scanToolEvents(events);
    expect(calls).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  it("扫描切片时 seq 是窗口内下标，不是会话序号（跨窗口归因需自行加偏移）", () => {
    resetSeq();
    const events = [result("w0"), call("w1", "read", '{"file_path":"/w.ts"}')];
    const full = scanToolEvents(events);
    const sliced = scanToolEvents(events.slice(1));
    expect(full.calls[0]?.seq).toBe(1);
    expect(sliced.calls[0]?.seq).toBe(0);
    // 单条入口的 index 由调用方给：折叠侧传 event.seq，扫描侧传窗口下标，两者不保证同值。
    expect(toolEventRowsOf(events[1], 0).call?.seq).toBe(0);
  });

  it("无 callId 的 tool/call 保留 undefined（调用方造 nc: 键）", () => {
    resetSeq();
    // 官方 `tool/call.callId` 必选，故这条坏数据只能经 badEvent 表达。
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

  it("PTC dispatch 缺/非布尔 isError 视为坏结算跳过（官方必选，不能按成功）", () => {
    resetSeq();
    const { results } = scanToolEvents([
      badEvent({ type: PTC_DISPATCH_TYPE, data: { subCallId: "rc1:ptc:1", name: "read" } }),
      badEvent({
        type: PTC_DISPATCH_TYPE,
        data: { subCallId: "rc1:ptc:2", name: "read", isError: "false" },
      }),
    ]);
    expect(results).toHaveLength(0);
  });
});

describe("失败身份读取（data.error）", () => {
  it("tool/result 的失败身份进入结算记录；reason 是字符串时一并保留", () => {
    resetSeq();
    const rows = toolEventRowsOf(
      result("r1", true, {
        name: "ApprovalError",
        code: "APPROVAL_REJECTED",
        reason: "user said no",
      }),
      0,
    ).result;
    expect(rows?.error).toStrictEqual({
      name: "ApprovalError",
      code: "APPROVAL_REJECTED",
      reason: "user said no",
    });
    // reason 非字符串 → 字段不出现（保持可选字段的原始形状）
    resetSeq();
    const withoutReason = toolEventRowsOf(
      badEvent({
        type: RESULT_TYPE,
        data: {
          message: { source: { callId: "r2" }, isError: true },
          error: { name: "AbortError", code: "ABORTED", reason: 42 },
        },
      }),
      0,
    ).result;
    expect(withoutReason?.error).toStrictEqual({ name: "AbortError", code: "ABORTED" });
  });

  it("PTC dispatch 的失败身份在 data 顶层，同样进入结算记录", () => {
    resetSeq();
    const rows = toolEventRowsOf(
      ptcSettle("rc1:ptc:1", "edit", true, { name: "AbortError", code: "ABORTED" }),
      0,
    ).result;
    expect(rows?.error).toStrictEqual({ name: "AbortError", code: "ABORTED" });
  });

  it("成功结算即使带 data.error 也不保留失败身份（不产出 isError:false + error）", () => {
    resetSeq();
    const native = toolEventRowsOf(
      badEvent({
        type: RESULT_TYPE,
        data: {
          message: { source: { callId: "ok-native" }, isError: false },
          error: { name: "WeirdError", code: "WEIRD" },
        },
      }),
      0,
    ).result;
    expect(native?.isError).toBe(false);
    expect(native?.error).toBeUndefined();

    resetSeq();
    const ptc = toolEventRowsOf(
      ptcSettle("rc1:ptc:ok", "edit", false, { name: "WeirdError", code: "WEIRD" }),
      0,
    ).result;
    expect(ptc?.isError).toBe(false);
    expect(ptc?.error).toBeUndefined();
  });

  it("缺失或半截身份一律 undefined（分类不能建立在不完整证据上）", () => {
    resetSeq();
    const malformed = [
      // 完全缺失
      badEvent({
        type: RESULT_TYPE,
        data: { message: { source: { callId: "m0" }, isError: true } },
      }),
      // 不是对象
      badEvent({
        type: RESULT_TYPE,
        data: { message: { source: { callId: "m1" }, isError: true }, error: "boom" },
      }),
      // name 缺失 / 非字符串 / 空串
      badEvent({
        type: RESULT_TYPE,
        data: { message: { source: { callId: "m2" }, isError: true }, error: { code: "X" } },
      }),
      badEvent({
        type: RESULT_TYPE,
        data: {
          message: { source: { callId: "m3" }, isError: true },
          error: { name: 1, code: "X" },
        },
      }),
      badEvent({
        type: RESULT_TYPE,
        data: {
          message: { source: { callId: "m4" }, isError: true },
          error: { name: "", code: "X" },
        },
      }),
      // code 缺失 / 非字符串 / 空串
      badEvent({
        type: RESULT_TYPE,
        data: { message: { source: { callId: "m5" }, isError: true }, error: { name: "N" } },
      }),
      badEvent({
        type: RESULT_TYPE,
        data: {
          message: { source: { callId: "m6" }, isError: true },
          error: { name: "N", code: 2 },
        },
      }),
      badEvent({
        type: RESULT_TYPE,
        data: {
          message: { source: { callId: "m7" }, isError: true },
          error: { name: "N", code: "" },
        },
      }),
      // PTC 侧同样处理
      badEvent({
        type: PTC_DISPATCH_TYPE,
        data: { subCallId: "rc1:ptc:9", isError: true, error: { name: "N" } },
      }),
    ];
    const errors = scanToolEvents(malformed).results.map((row) => row.error);
    expect(errors.filter((error) => error !== undefined)).toStrictEqual([]);
  });
});

describe("成败位读取（经 toolEventRowsOf 这条公开接口）", () => {
  it("message.isError===true 判失败；false/缺失按成功（v4 message 级）", () => {
    resetSeq();
    expect(isErrorOf(result("r1", true))).toBe(true);
    expect(isErrorOf(result("r2", false))).toBe(false);
    // 官方 isError 可选：合法 message 缺位 = 成功；但 message 本身不可用不是同一件事。
    expect(
      isErrorOf(
        badEvent({
          type: RESULT_TYPE,
          data: { message: { source: { callId: "r3" } } },
        }),
      ),
    ).toBe(false);
  });

  it("tool/result 缺 message / source / callId 不出结算行（无配对键不能冒充已结算）", () => {
    resetSeq();
    const { results } = scanToolEvents([
      badEvent({ type: RESULT_TYPE, data: {} }),
      badEvent({ type: RESULT_TYPE, data: { message: {} } }),
      badEvent({ type: RESULT_TYPE, data: { message: { source: { callId: "c" } } } }),
    ]);
    expect(results.map((row) => row.callId)).toStrictEqual(["c"]);
    expect(results[0]?.isError).toBe(false);
  });

  it("tool/result 的 isError 非布尔是坏形状，不产出结算行（未知不能当成功）", () => {
    resetSeq();
    const { results } = scanToolEvents([
      badEvent({
        type: RESULT_TYPE,
        data: { message: { source: { callId: "bad" }, isError: "false" } },
      }),
    ]);
    expect(results).toHaveLength(0);
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
    // 本模块只认 v4 位置、不做 content[] 回退——若宿主仍发旧形状，这里就是
    // fail-open 的显式特征：isError:true 也判成功。改回回退会让本断言失败。
    const retired = badEvent({
      type: RESULT_TYPE,
      data: { message: { source: { callId: "retired" }, content: [{ isError: true }] } },
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

describe("apply_patch 目标解析", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: a.ts",
    "+a",
    "*** Update File: b.ts",
    "*** Move to: c.ts",
    "@@",
    "-old",
    "+new",
    "*** Delete File: d.ts",
    "*** End Patch",
  ].join("\n");

  it("按官方 parser 交回有序操作（含 move 的目的路径）", () => {
    expect(applyPatchTargetsOf({ input: patch })).toStrictEqual([
      { kind: "add", path: "a.ts" },
      { kind: "update", path: "b.ts", moveTo: "c.ts" },
      { kind: "delete", path: "d.ts" },
    ]);
  });

  it("update 没有 move 时交回不带 moveTo 的目标", () => {
    const withoutMove = [
      "*** Begin Patch",
      "*** Update File: e.ts",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n");
    expect(applyPatchTargetsOf({ input: withoutMove })).toStrictEqual([
      { kind: "update", path: "e.ts" },
    ]);
  });

  it("非补丁输入与非法补丁交回空表（调用方按工具名 fail-closed）", () => {
    expect(applyPatchTargetsOf({ input: "hello" })).toStrictEqual([]);
    expect(applyPatchTargetsOf({ input: "*** Begin Patch\n*** Update File: a.ts" })).toStrictEqual(
      [],
    );
    expect(applyPatchTargetsOf({ input: 42 })).toStrictEqual([]);
    expect(applyPatchTargetsOf(undefined)).toStrictEqual([]);
  });

  it("editPathsOf 交回全部写目标并去重，move 的源与目的都在表内", () => {
    expect(editPathsOf(applyPatchCall(patch))).toStrictEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    const repeated = patch.replace("*** Delete File: d.ts", "*** Delete File: a.ts");
    expect(editPathsOf(applyPatchCall(repeated))).toStrictEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("editPathOf 对 apply_patch 只交回第一条目标（单目标兼容）", () => {
    expect(editPathOf(applyPatchCall(patch))).toStrictEqual({ kind: "write", path: "a.ts" });
  });

  it("editPathsOf 对普通编辑器沿用单路径做法（view 与无路径不成行）", () => {
    expect(
      editPathsOf({
        name: "edit",
        callId: "e1",
        seq: 0,
        arguments: { file_path: "/a.ts" },
        badArguments: false,
      }),
    ).toStrictEqual(["/a.ts"]);
    expect(
      editPathsOf({
        name: "edit",
        callId: "e2",
        seq: 0,
        arguments: {},
        badArguments: false,
      }),
    ).toStrictEqual([]);
    expect(
      editPathsOf({
        name: "str_replace_editor",
        callId: "e3",
        seq: 0,
        arguments: { command: "view", path: "/v.ts" },
        badArguments: false,
      }),
    ).toStrictEqual([]);
    expect(
      editPathsOf({
        name: "str_replace_editor",
        callId: "e4",
        seq: 0,
        arguments: { command: "str_replace", path: "/w.ts" },
        badArguments: false,
      }),
    ).toStrictEqual(["/w.ts"]);
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

  it("缺 name 的调用不出行：它是分桶键，滤在扫描层而不是留给消费方", () => {
    resetSeq();
    // 官方类型把 name 声明成必选，但 append 只过 snapshotJsonValue、随后的
    // validateSessionEventData 自述不校验完整载荷，所以缺 name 的 tool/call 真的能进日志。
    const { calls } = scanToolEvents([
      badEvent({ type: "tool/call", data: { turn: 1, step: 1, callId: "c1", arguments: "{}" } }),
      // name 是空串同样不算（与 usableCallId 对空串的处理一致）
      badEvent({
        type: "tool/call",
        data: { turn: 1, step: 1, callId: "c2", name: "", arguments: "{}" },
      }),
      badEvent({
        type: PTC_START_TYPE,
        data: { rootCallId: "r", parentCallId: "p", subCallId: "s1", arguments: {} },
      }),
      // 同流里的正常调用不受影响，且 seq 仍取入参下标
      call("c3", "edit", '{"file_path":"/a.ts"}'),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "edit", callId: "c3", seq: 3 });
  });

  it("数组里的 null 元素同样静默跳过（官方元素记为非可空，只有坏数据才有）", () => {
    resetSeq();
    // 曾按 `event?.data` 读，改写为判别联合时丢了这层：null 会在读 .data 时抛 TypeError，
    // 把「零星坏事件不抛错」的约定打断在检查路径上。此用例固定它。
    const withNull = [
      null,
      call("n1", "edit", '{"file_path":"/n.ts"}'),
    ] as unknown as SessionEvent[];
    const { calls } = scanToolEvents(withNull);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.callId).toBe("n1");
    expect(calls[0]?.seq).toBe(1);
  });

  it("直接调用 toolEventRowsOf(null/undefined) 也不抛（公共入口自己守边界）", () => {
    expect(toolEventRowsOf(null, 0)).toStrictEqual({ call: undefined, result: undefined });
    expect(toolEventRowsOf(undefined, 0)).toStrictEqual({ call: undefined, result: undefined });
  });

  it("callId 非字符串（坏契约）→ 调用行归 undefined；结算行整条丢弃", () => {
    resetSeq();
    const { calls, results } = scanToolEvents([
      badEvent({ type: RESULT_TYPE, data: { message: { source: { callId: 7 } } } }),
      badEvent({
        type: "tool/call",
        data: { turn: 1, step: 1, name: "edit", arguments: {}, callId: 5 },
      }),
    ]);
    expect(calls[0]?.callId).toBeUndefined();
    expect(results).toStrictEqual([]);
  });
});

describe("规模面：万级事件流", () => {
  /** 规模用例的事件对数。1 万条事件在 20s 超时下留足余量，同时足以让任何二次方复杂度的写法暴露出来。 */
  const SCALE = 5000;

  it("逐项同解：两张表行数、串联键与事件位都不随规模改做法", () => {
    // 这条不是计时断言（那会变成 flaky），而是**规模下的等价性**：扫描器每条事件只读
    // 一遍常数次，两张表各自有序、seq 就是事件位。消费方（quality-gate 的 collectEdits、
    // danger-guard 的记录折叠）在长会话上跑的就是这条路径，行为不能因为事件多就变。
    const evs: SessionEvent[] = [];
    for (let i = 0; i < SCALE; i += 1) {
      const id = `c${String(i)}`;
      evs.push(call(id, "read", `{"file_path":"/a/f${String(i)}.ts"}`), result(id));
      // 每十轮插一条非工具事件：顺带固定「不进表的行照占事件位、后面的 seq 不塌陷」。
      if (i % 10 === 0) {
        evs.push(unrelated());
      }
    }
    const scanned = scanToolEvents(evs);
    expect(scanned.calls).toHaveLength(SCALE);
    expect(scanned.results).toHaveLength(SCALE);
    expect(scanned.calls[0]?.callId).toBe("c0");
    expect(scanned.calls[SCALE - 1]?.callId).toBe(`c${String(SCALE - 1)}`);
    expect(scanned.calls[0]?.arguments).toStrictEqual({ file_path: "/a/f0.ts" });
    // 两张表各自按事件位严格递增（不能因为剔掉了非工具事件就重新编号）。
    for (let i = 1; i < SCALE; i += 1) {
      expect(scanned.calls[i]!.seq).toBeGreaterThan(scanned.calls[i - 1]!.seq);
      expect(scanned.results[i]!.seq).toBeGreaterThan(scanned.results[i - 1]!.seq);
    }
    // 结算与调用一一对应：第 i 次调用与第 i 次结算挂在同一个 callId 上。
    for (let i = 0; i < SCALE; i += 1) {
      expect(scanned.results[i]?.callId).toBe(scanned.calls[i]?.callId);
    }
  });

  it("规模下缺 name 的调用仍被整条滤掉（滤除不是抽样）", () => {
    // 与上面那条并置才有意义：小样本里滤对一条是巧合，1 万条里还滤对才是稳定的保证。
    const evs: SessionEvent[] = [];
    for (let i = 0; i < SCALE; i += 1) {
      evs.push(badEvent({ type: CALL_TYPE, data: { arguments: "{}" } }));
      const id = `k${String(i)}`;
      evs.push(call(id, "read", "{}"), result(id));
    }
    const scanned = scanToolEvents(evs);
    expect(scanned.calls).toHaveLength(SCALE);
    expect(scanned.calls.every((row) => row.name === "read")).toBe(true);
    // 滤掉坏事件不改变后续事件的串联键。
    expect(scanned.calls[0]?.callId).toBe("k0");
  });
});
