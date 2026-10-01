// lib/tool-events.ts —— tool 事件流记账（quality-gate EditAccumulator 与
// danger-guard FactGate 证据链的公共骨架，已收敛到 shared）。
//
// 共性问题（两插件各自实现同一契约、双份维护）：
//   1. tool/call 的 arguments 官方是模型产出的**原始 JSON 字符串**，而 PTC 子调度的
//      arguments 官方是派发前已 JSON 归一化的 `unknown` —— 两种形态都真实存在，
//      parseToolArguments 的双分支不是防御性冗余；
//   2. tool/result 用 callId 串联 tool/call，isError 判定成败；
//   3. str_replace_editor 的 view 是只读、不算"写"（两插件都要跳过）；
//   4. PTC 模式（run_code）的子工具调用以 tool/ptc-dispatch-start + tool/ptc-dispatch
//      事件入流，与 tool/call + tool/result 同义：start 记调用（callId 由 subCallId
//      承担）、dispatch 记成败（isError 在 data 顶层）。扫描器必须把它归并进同一张表，
//      否则门禁/证据链在 PTC 模式下对子调用完全失明（gaps 永不收敛）。
// 本模块只提供「读取 session 事件流 → 结构化记账」的纯函数部分；领域判定（哪些工具算
// 编辑、路径过滤、预算/门禁逻辑）留在各插件。
//
// 事件形状取官方判别联合 `@deepseek-ai/dsh-session` 的 `SessionEvent`，不再本地声明
// 「最小投影」：按 `event.type` 分支即收窄 `event.data`，宿主改名/换形状在编译期暴露，
// 而不是靠注释手抄 d.ts 行号。两个 PTC 事件由 `@deepseek-ai/dsh-tools/types` 以
// `declare module '@deepseek-ai/dsh-session/types'` 官方增强进 `SessionEventMap`——
// 下面那行具名 re-export 既是给消费方的类型出口，也把该增强带进本模块的 program
// （TS7 不接受 `import type "mod"` 这种无绑定形式，不具名引用就看不见这两个变体）。

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { isRecord } from "./record.ts";

export type { SessionEvent } from "@deepseek-ai/dsh-session";
export type { PtcDispatchEventData, PtcDispatchStartEventData } from "@deepseek-ai/dsh-tools/types";

/** 一条 tool/call 的记账记录。 */
export interface ToolCallRecord {
  /** 调用名（edit/write/str_replace_editor/read/grep/…）。 */
  name: string | undefined;
  /** callId：tool/result 串联键；缺失时由调用方按 seq 造 `nc:` 键。 */
  callId: string | undefined;
  /** 解析后的参数对象（解析失败/非对象时为空对象，配合 badArguments 使用）。 */
  arguments: Record<string, unknown>;
  /**
   * arguments 原始值无法解析为对象（JSON 字符串非法、或非字符串非对象）。
   * 调用方据此保留各自语义：quality-gate 判 EDIT_SKIP、danger-guard 跳过记账——
   * 共享层只标记不决策，避免把两插件的"坏参是否记账"策略悄悄统一。
   */
  badArguments: boolean;
  /**
   * 在**入参数组**中的下标（归因/游标用），不是官方事件自带的 `SessionSeq`：消费方按
   * 窗口切片读取事件流，切片下标才是它们游标语义里的那个「序」。
   */
  seq: number;
}

/** 一条 tool/result 的成败。 */
export interface ToolResultRecord {
  callId: string | undefined;
  isError: boolean;
  seq: number;
}

/** 从 message 面读 v4 的成败位；非对象/缺位一律按成功。 */
function readIsError(raw: unknown): boolean {
  return isRecord(raw) && raw["isError"] === true;
}

/** 显式 true 才算真（缺失/非布尔一律 false）：官方把 PTC 结算的 isError 标成必选
 *  boolean，但类型挡不住重放数据里缺位的情形，缺位必须按成功而不是 undefined。 */
function isTrueFlag(value: unknown): boolean {
  return value === true;
}

/** 官方保证每个事件必带对象 `data`。这里仍校验：扫描器跑在门禁/证据链的同步热路径上，
 *  契约是「零星坏事件静默跳过、不抛错」，而重放或跨边界数据可以送来临时缺 data 的事件。
 *  类型面已把 data 记为必选，所以这个门槛在 TS 里是恒真——它防的是类型外的输入。 */
function hasObjectData(event: SessionEvent): boolean {
  return isRecord(event.data);
}

/**
 * 官方把 `callId` / `subCallId` 声明为 `ToolCallId`（品牌串，必选）。这里仍校验字符串
 * 形态并按 `string` 交出：类型面挡不住跨持久化/进程边界送来的坏契约，而「把非串当真实
 * 串联键」会让 tool/result 与 tool/call 错配。空串同样归 undefined——空 callId 与缺席
 * 一样不可信，不得冒充键（记账面因此是 `string | undefined` 而非官方品牌类型）。
 */
function usableCallId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * tool/result 的 isError 判定（官方 v4：成败位在 message 级、类型为 `?: boolean`；
 * 字段缺失按成功）。非 tool/result 事件一律按成功——PTC 子调度的成败位在 data 顶层，
 * 由 `resultRecordOf` 的对应分支处理，不从这儿走。
 */
export function resultIsError(event: SessionEvent): boolean {
  return event.type === "tool/result" && readIsError(event.data.message);
}

/** 解析 tool/call 的 arguments：string JSON 文本或已解析对象；非法/缺失 → 空对象。 */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(raw) ? raw : {};
}

/**
 * arguments 是否「无法参与记账」：仅当字符串 JSON **语法非法**（JSON.parse 抛错）。
 * 合法 JSON 非对象（"42"）、undefined/数字/对象等一律不标——quality-gate 原实现
 * 对 JSON.parse 抛错判 EDIT_SKIP，但对"解析成功却非对象"仍记账（path=undefined），
 * 本标记必须精确复用那一个语义点，不能把"非对象"也划进坏参。
 */
export function toolArgumentsBad(raw: unknown): boolean {
  if (typeof raw === "string") {
    try {
      JSON.parse(raw);
      return false;
    } catch {
      return true;
    }
  }
  return false;
}

/** 调用类事件（tool/call 与 PTC 子调用开始）→ 记账记录；其余返回 undefined。 */
function callRecordOf(event: SessionEvent, index: number): ToolCallRecord | undefined {
  let record: ToolCallRecord | undefined;
  if (!hasObjectData(event)) {
    return record;
  }
  if (event.type === "tool/call") {
    record = {
      name: event.data.name,
      callId: usableCallId(event.data.callId),
      arguments: parseToolArguments(event.data.arguments),
      badArguments: toolArgumentsBad(event.data.arguments),
      seq: index,
    };
  } else if (event.type === "tool/ptc-dispatch-start") {
    // PTC 子调用开始与 tool/call 同义，差别有二：串联键由 subCallId 承担，且 arguments
    // 官方是派发前已归一化的 `unknown`（不是 raw JSON 串）。缺失配对键即坏事件：直接
    // 跳过，不给 `nc:` 保守成功待遇——造出假证据会让门禁 fail-open（原实现同口径）。
    const subCallId = usableCallId(event.data.subCallId);
    if (subCallId !== undefined) {
      record = {
        name: event.data.name,
        callId: subCallId,
        arguments: parseToolArguments(event.data.arguments),
        badArguments: toolArgumentsBad(event.data.arguments),
        seq: index,
      };
    }
  }
  return record;
}

/** 结算类事件（tool/result 与 PTC 子调度结算）→ 成败记录；其余返回 undefined。 */
function resultRecordOf(event: SessionEvent, index: number): ToolResultRecord | undefined {
  let record: ToolResultRecord | undefined;
  if (!hasObjectData(event)) {
    return record;
  }
  if (event.type === "tool/result") {
    // 官方 `data.message` 必选、类型是 ToolResultMessage；仍按 unknown 读，理由见
    // usableCallId —— 重放/跨进程边界上送来的坏形状不在类型面内。
    const message: unknown = event.data.message;
    const source = isRecord(message) ? message["source"] : undefined;
    record = {
      callId: isRecord(source) ? usableCallId(source["callId"]) : undefined,
      isError: readIsError(message),
      seq: index,
    };
  } else if (event.type === "tool/ptc-dispatch") {
    // PTC 子调用结算：isError 在 data 顶层（官方必选），与 tool/result 的 message 内嵌
    // 不同；同样要求配对键可用，否则整条事件按坏事件丢弃。
    const subCallId = usableCallId(event.data.subCallId);
    if (subCallId !== undefined) {
      record = { callId: subCallId, isError: isTrueFlag(event.data.isError), seq: index };
    }
  }
  return record;
}

/** 一条事件产出的记账行（call 与 result 互斥；非记账事件两位都是 undefined）。 */
export interface ToolEventRows {
  call: ToolCallRecord | undefined;
  result: ToolResultRecord | undefined;
}

/**
 * **单条事件**的记账行（`scanToolEvents` 的一步，也是它唯一的实现处）。
 *
 * 之所以导出：danger-guard 把同一套台账折成 `sessionProjections` 投影单元（增量折叠）后，
 * 折叠与"注册表缺席时的全量扫描"必须逐字同源——两处各写一遍字段读取，就会在两行上给出
 * 不同的证据链（那是安全门禁的 fail-open）。折叠侧传 `event.seq`，扫描侧传数组下标，
 * 两者在官方 `seq = log.length` 的连号契约下同一个值。
 */
export function toolEventRowsOf(event: SessionEvent, index: number): ToolEventRows {
  return { call: callRecordOf(event, index), result: resultRecordOf(event, index) };
}

/**
 * 扫描事件流 → tool/call 与 tool/result 两张表。
 * 只收集形状可用的事件，其余静默跳过——调用方（门禁/证据链）以空表安全降级，不因零星
 * 坏事件抛错。数组空洞（类型面不可表示、重放数据里却可能出现）同样跳过。
 * seq 取事件在入参数组里的下标（与 danger-guard scanToolCalls 的归因语义一致）。
 */
export function scanToolEvents(events: readonly SessionEvent[]): {
  calls: ToolCallRecord[];
  results: ToolResultRecord[];
} {
  const calls: ToolCallRecord[] = [];
  const results: ToolResultRecord[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    // 空洞与类型面不可表示的非对象元素（重放数据里的 null 等）整条跳过：官方把数组元素
    // 记为非可空，所以 `!== undefined` 挡不住 null，而下面按字段读取会直接 TypeError。
    if (event !== undefined && isRecord(event)) {
      const { call, result } = toolEventRowsOf(event, index);
      if (call !== undefined) {
        calls.push(call);
      }
      if (result !== undefined) {
        results.push(result);
      }
    }
  }
  return { calls, results };
}

function pathOf(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 由 tool/call 记录推导被编辑的文件路径；str_replace_editor 的 view 只读不算写。
 * @returns { kind: "write", path } 写操作；{ kind: "read-view", path } 只读视图；
 *          { kind: "skip" } 无路径或参数形状不可用（调用方忽略）。
 */
export function editPathOf(call: ToolCallRecord): {
  kind: "write" | "read-view" | "skip";
  path: string | undefined;
} {
  const args = call.arguments;
  if (call.name === "str_replace_editor") {
    return args["command"] === "view"
      ? { kind: "read-view", path: pathOf(args, "path") }
      : { kind: "write", path: pathOf(args, "path") };
  }
  return { kind: "write", path: pathOf(args, "file_path") };
}
