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
/** PTC 子调用开始：同样走坏事件构造，故与结算一并列出。 */
const PTC_START_TYPE = "tool/ptc-dispatch-start";
const RESULT_TYPE = "tool/result";
/** 同上的 tool/call 字面量（坏事件构造点要用它，事件类型本身保持合法以证明是 data 的锅）。 */
const CALL_TYPE = "tool/call";

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

  it("缺 name 的调用不出行：它是分桶键，滤在扫描层而不是留给消费方", () => {
    resetSeq();
    // 官方类型把 name 声明成必选，但 append 只过 snapshotJsonValue、随后的
    // validateSessionEventData 自述不校验完整载荷，所以缺 name 的 tool/call 真的能进日志。
    const { calls } = scanToolEvents([
      badEvent({ type: "tool/call", data: { turn: 1, step: 1, callId: "c1", arguments: "{}" } }),
      // name 是空串同样不算（与 usableCallId 的空串口径一致）
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

describe("规模面：万级事件流", () => {
  /** 规模用例的事件对数。1 万条事件在 20s 超时下留足余量，同时足以让任何二次方写法露馅。 */
  const SCALE = 5000;

  it("逐项同解：两张表行数、串联键与事件位都不随规模改口径", () => {
    // 这条不是计时断言（那会变成 flaky），而是**规模下的等价性**：扫描器每条事件只读
    // 一遍常数次，两张表各自有序、seq 就是事件位。消费方（quality-gate 的 collectEdits、
    // danger-guard 的台账折叠）在长会话上跑的就是这条路径，口径不能因为事件多就变。
    const evs: SessionEvent[] = [];
    for (let i = 0; i < SCALE; i += 1) {
      const id = `c${String(i)}`;
      evs.push(call(id, "read", `{"file_path":"/a/f${String(i)}.ts"}`), result(id));
      // 每十轮插一条非工具事件：顺带钉住「不进表的行照占事件位、后面的 seq 不塌陷」。
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
    // 结算与调用一一对应：第 i 次调用与第 i 次结算挂在同一枚 callId 上。
    for (let i = 0; i < SCALE; i += 1) {
      expect(scanned.results[i]?.callId).toBe(scanned.calls[i]?.callId);
    }
  });

  it("规模下缺 name 的调用仍被整条滤掉（滤除不是抽样）", () => {
    // 与上面那条并置才有意义：小样本里滤对一条是巧合，1 万条里还滤对才是口径。
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
