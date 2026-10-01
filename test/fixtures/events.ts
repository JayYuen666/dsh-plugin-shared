// test/fixtures/events.ts —— 官方 `SessionEvent` 夹具构造器。
//
// 生产面（lib/tool-events.ts）绑官方判别联合后，夹具必须满足本地投影曾一笔带过的三条
// 真约束（都是这一轮由编译器逼出来的，写在这里备忘）：
//   1. 信封必填位齐全：`seq`（且它是 `SessionSeq = BrandedNumber<'SessionSeq'>`，不是
//      number）、`time`，以及 `data.turn` / `data.step`；
//   2. `callId` / `subCallId` 是 `ToolCallId` 品牌串，`tool/result.message.id` 是
//      `MessageId` 品牌串——裸字符串不能直接书写；
//   3. `tool/result` 属官方 `SurfaceEventType`：消息生产事件**必须**自带 `surfaceOp`，
//      `Session.append` 对缺它的写入直接拒收。这条在本地投影里完全看不见。
// 三件事集中在本文件做一次，而不是让每个用例各自抄信封、或在成百处字面量上散 _cast。
// 要测「宿主真送来畸形事件」的用例仍显式走 badEvent()——那是用例明说的意图，不是把
// 生产类型放宽成可选换来的。

import { brandNumber, brandString } from "@deepseek-ai/dsh-brand";
import type { MessageId, ToolCallId } from "@deepseek-ai/dsh-llm";
import type { SessionEvent, SessionSeq } from "@deepseek-ai/dsh-session";

/** 夹具事件的下标即扫描器看到的流序；递增器保证与书写顺序一致。 */
let nextSeq = 0;

/** 每个用例开头调用，令 seq 从流首计起。 */
export function resetSeq(): void {
  nextSeq = 0;
}

function seq(): SessionSeq {
  return brandNumber<SessionSeq>(nextSeq);
}

function bump(): void {
  nextSeq += 1;
}

/** 裸串 → 官方品牌串（`brandString` 是 dsh-brand 的正规入口）。 */
export function toolCallId(id: string): ToolCallId {
  return brandString<ToolCallId>(id);
}

/** `tool/call`：`arguments` 官方是模型产出的原始 JSON 字符串。 */
export function call(id: string, name: string, argsJson: string): SessionEvent {
  const event: SessionEvent = {
    type: "tool/call",
    seq: seq(),
    time: 0,
    data: { turn: 1, step: 1, callId: toolCallId(id), name, arguments: argsJson },
  };
  bump();
  return event;
}

/** `tool/result`：成败位在 message 级（官方 `isError?: boolean`）。 */
export function result(id: string, isError = false): SessionEvent {
  const event: SessionEvent = {
    type: "tool/result",
    seq: seq(),
    time: 0,
    surfaceOp: "append",
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "tool",
        id: brandString<MessageId>(`msg:${id}`),
        source: { kind: "tool", callId: toolCallId(id) },
        toolCallId: toolCallId(id),
        content: [],
        isError,
      },
    },
  };
  bump();
  return event;
}

/** PTC 子调度的三个官方必填 id（rootCallId/parentCallId 本模块不读，但形状必带）。 */
function ptcIds(subId: string): {
  rootCallId: ToolCallId;
  parentCallId: ToolCallId;
  subCallId: ToolCallId;
} {
  return {
    rootCallId: toolCallId(`root:${subId}`),
    parentCallId: toolCallId(`parent:${subId}`),
    subCallId: toolCallId(subId),
  };
}

/** PTC 子调用开始：`arguments` 官方是派发前已归一化的 `unknown`。 */
export function ptcCall(subId: string, name: string, args: unknown): SessionEvent {
  const event: SessionEvent = {
    type: "tool/ptc-dispatch-start",
    seq: seq(),
    time: 0,
    data: { ...ptcIds(subId), name, arguments: args },
  };
  bump();
  return event;
}

/** PTC 子调用结算：`isError` 在 data 顶层且官方必选。 */
export function ptcSettle(subId: string, name: string, isError: boolean): SessionEvent {
  const event: SessionEvent = {
    type: "tool/ptc-dispatch",
    seq: seq(),
    time: 0,
    data: { ...ptcIds(subId), name, arguments: {}, isError, content: [] },
  };
  bump();
  return event;
}

/** 与本模块无关的事件：官方 `turn/start` 的载荷最省（只有 `turn`），用来钉住
 *  「非工具事件不进两张表」。 */
export function unrelated(): SessionEvent {
  const event: SessionEvent = { type: "turn/start", seq: seq(), time: 0, data: { turn: 1 } };
  bump();
  return event;
}

/** 显式畸形事件：类型面已不可表示的坏形状（缺 callId、data 非对象、未知类型、retired
 *  的 content[0].isError……）。个别用例经它表达「宿主真送来了这个」，测的是扫描器的
 *  降级口径，不是类型合法性。 */
export function badEvent(value: Record<string, unknown>): SessionEvent {
  bump();
  return value as unknown as SessionEvent;
}
