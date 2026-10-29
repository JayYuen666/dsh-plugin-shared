// lib/tool-events.ts —— tool 事件流记录（quality-gate EditAccumulator 与
// danger-guard FactGate 证据链的公共实现，已统一到 shared）。
//
// 共性问题（两插件各自实现同一约定、双份维护）：
//   1. tool/call 的 arguments 官方是模型产出的**原始 JSON 字符串**，而 PTC 子调度的
//      arguments 官方是派发前已 JSON 归一化的 `unknown` —— 两种形态都真实存在，
//      readArguments 的双分支不是防御性冗余；
//   2. tool/result 用 callId 串联 tool/call，isError 判定成败；
//   3. str_replace_editor 的 view 是只读、不算"写"（两插件都要跳过）；
//   4. PTC 模式（run_code）的子工具调用以 tool/ptc-dispatch-start + tool/ptc-dispatch
//      事件入流，与 tool/call + tool/result 同义：start 记调用（callId 由 subCallId
//      承担）、dispatch 记成败（isError 在 data 顶层）。扫描器必须把它合并进同一张表，
//      否则检查/证据链在 PTC 模式下对子调用完全看不见（gaps 永不清空）。
// 本模块只提供「读取 session 事件流 → 结构化记录」的纯函数部分；领域判定（哪些工具算
// 编辑、路径过滤、预算/检查逻辑）留在各插件。
//
// 事件形状取官方判别联合 `@deepseek-ai/dsh-session` 的 `SessionEvent`，不再本地声明
// 「最小投影」：按 `event.type` 分支即收窄 `event.data`，宿主改名/换形状在编译期暴露，
// 而不是靠注释手抄 d.ts 行号。
//
// 两个 PTC 事件是这条规则的**例外**，载荷在本包内声明：官方把这两个变体增强进
// `SessionEventMap` 的那份声明**换过宿主包**，而支持窗口同时含换之前与换之后的版本，
// 新包在旧版宿主上根本没发布——从任何一侧具名 re-export 都会在另一侧解析不到。
// `skipLibCheck` 只豁免被消费的 `.d.ts`，不豁免本包自己的源码，所以那一侧是构建硬失败
// 而不是消费方的隐患。自己声明接口、自己做那份增强，两条宿主线上都成立。
// 与宿主真实定义是否仍同形由 test/tool-events-host-parity.ts 的双向可赋值断言钉住——那是
// 一条**编译期**判据，只有 tsc 兑现得了（该文件头记了为什么不能包成用例）。

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import type { ContentBlock } from "@deepseek-ai/dsh-llm/types";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import { isRecord } from "./record.ts";

export type { SessionEvent } from "@deepseek-ai/dsh-session";

/** 一枚 PTC 子调度**开始**时记下的载荷。字段与宿主声明逐位同形，理由见文件头。 */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId;
  parentCallId: ToolCallId;
  subCallId: ToolCallId;
  name: string;
  arguments: unknown;
}

/** 一枚 PTC 子调度**结算**时记下的载荷：结算面沿用 `tool/result` 自己的词表。 */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean;
  content: ContentBlock[];
  /** 可重放的工具侧呈现元数据，与模型可见内容分开记账。 */
  meta?: JsonValue;
  /** 可选的失败身份与原始用户可见细节，不在模型可见内容里。 */
  error?: {
    name: string;
    code: string;
    reason?: string;
  };
}

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    "tool/ptc-dispatch-start": PtcDispatchStartEventData;
    "tool/ptc-dispatch": PtcDispatchEventData;
  }
}

/**
 * 一条 tool/call 的记录。
 *
 * 字段一律 `readonly`：记录一旦入表就只作证据读，记录被就地改写会让证据链失去意义。
 */
export interface ToolCallRecord {
  /**
   * 调用名（edit/write/str_replace_editor/read/grep/…）——本模块的**分组键**，必选。
   *
   * 官方把它声明成必选 `string`（`tool/call` 见 packages/core/session/src/types.ts:361，
   * PtcDispatchStartEventData.name 见 packages/core/tools/src/types.ts:15），但运行期拦不住
   * （依据见 usableName）。所以可空性在**扫描层**就处理掉了，不带到类型声明：callRecordOf 遇到
   * 缺可用 name 的调用类事件整条跳过，与 hasObjectData 同一规则。
   *
   * 为什么不把过滤留给消费方：下游分类全建立在 name 上——editPathOf 的 str_replace_editor
   * 只读判定、检查侧的 EDIT_TOOLS 与 refSearchTools 名单——而 editPathOf 的回退分支会把任何
   * 非 str_replace_editor 的调用一律判成 write。无名调用一旦进了记录，只要它的 arguments
   * 里有 file_path 就算成写操作。现在是靠三个消费方各自记得先判一次才没出事——那是同一条
   * 不变式的三份手抄，漏一份就出事。
   *
   * 与 callId 的差别是**为什么一个必选、一个可空**：callId 由 usableCallId 回退，且它有
   * `nc:<seq>` 回退值（消费方的 noCallId 组专门收那种行），缺了不影响归类；name 一旦缺了
   * 就没法分组、没有回退值，只能在入口滤掉。
   */
  readonly name: string;
  /** callId：tool/result 串联键；缺失时由调用方按 seq 造 `nc:` 键。 */
  readonly callId: string | undefined;
  /** 解析后的参数对象（解析失败/非对象时为空对象，配合 badArguments 使用）。 */
  readonly arguments: Record<string, unknown>;
  /**
   * arguments 原始值无法解析为对象（JSON 字符串非法、或非字符串非对象）。
   * 调用方据此保留各自语义——有的把无效参数判成"这次编辑不入记录"，有的仍记录但路径留空。
   * 共享层只标记不决策：把两档策略统一掉，等于在其中一侧悄悄改掉检查的宽严。
   */
  readonly badArguments: boolean;
  /**
   * 在**入参数组**中的下标（归因/游标用），不是官方事件自带的 `SessionSeq`：消费方按
   * 窗口切片读取事件流，切片下标才是它们游标语义里的那个「序」。
   */
  readonly seq: number;
}

/** 一条 tool/result 的成败。同样只读。 */
export interface ToolResultRecord {
  readonly callId: string | undefined;
  readonly isError: boolean;
  readonly seq: number;
}

/** 从 message 结构读 v4 的成败位；非对象/缺位一律按成功。 */
function readIsError(raw: unknown): boolean {
  return isRecord(raw) && raw["isError"] === true;
}

/** 显式 true 才算真（缺失/非布尔一律 false）：官方把 PTC 结算的 isError 标成必选
 *  boolean，但类型挡不住重放数据里缺位的情形，缺位必须按成功而不是 undefined。 */
function isTrueFlag(value: unknown): boolean {
  return value === true;
}

/** 官方保证每个事件必带对象 `data`。这里仍校验：扫描器跑在检查/证据链的同步路径上，
 *  约定是「零星坏事件静默跳过、不抛错」，而重放或跨边界数据可以送来临时缺 data 的事件。
 *  类型声明已把 data 记为必选，所以这个检查在 TS 里是恒真——它防的是类型外的输入。 */
function hasObjectData(event: SessionEvent): boolean {
  return isRecord(event.data);
}

/**
 * 官方把 `callId` / `subCallId` 声明为 `ToolCallId`（官方自定义的字符串类型——运行期就是
 * `string`，必选）。这里仍校验字符串
 * 形态并按 `string` 交出：类型声明挡不住跨持久化/进程边界送来的坏数据，而「把非串当真实
 * 串联键」会让 tool/result 与 tool/call 错配。空串同样归 undefined——空 callId 与缺席
 * 一样不可信，不得冒充键（记录类型因此是 `string | undefined` 而非官方自定义的那个类型）。
 */
function usableCallId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 工具名取用：非空串才认，空串与非串一并归 undefined。判断与 `usableCallId` 同形，理由不同——
 * callId 是**串联键**，错了会让 tool/result 与 tool/call 错配；name 是**分组键**，而下游全部
 * 分类都建立在它之上（editPathOf 的 str_replace_editor 判定、检查侧的 EDIT_TOOLS /
 * refPolicy 名单）。没有 name 的调用无法归类。
 *
 * 官方把它声明成必选 `string`（`tool/call` 见 packages/core/session/src/types.ts:361，
 * PtcDispatchStartEventData.name 见 packages/core/tools/src/types.ts:15），但**运行期拦不住**：
 * Session.append 只过 snapshotJsonValue（只要是 lossless JSON 就放行），随后的
 * validateSessionEventData 自述「does not validate complete event payloads」且只覆盖几个
 * surface 事件、不含 tool/call。所以缺 name 的 tool/call 能被写进日志（实测：append 接受
 * `{ arguments: "{}" }`）。消费侧没有资格假设上游一定守约——这道过滤必须在本层做。
 */
function usableName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** arguments 的两个投影：可用的参数对象，以及「参数是否无效」标记。 */
interface ArgumentsView {
  readonly arguments: Record<string, unknown>;
  readonly badArguments: boolean;
}

/**
 * 解析 tool/call 的 arguments：string JSON 文本或已解析对象。
 *
 * 无效参数标记与解析必须同一次读：两件事都建立在「JSON.parse 抛没抛」上，拆成两个函数就得把
 * 同一串 JSON 解析两遍（同一份入参两次解析，第一次的抛错与否恰好决定第二次的结论）。
 * 判断是「仅当字符串 JSON **语法非法**」——合法 JSON 非对象（`"42"`）、undefined/数字/对象
 * 一律不标：既有消费方对 JSON.parse 抛错判"不入记录"，但对"解析成功却非对象"仍记录（路径
 * 留空）。不能把"非对象"也划进无效参数：多划进去一种，等于替消费方改了检查的宽严。
 *
 * 模块私有：两种事件形状的记录都经 `callRecordOf` 走这一处，外部消费方拿到的
 * `toolEventRowsOf` 记录里已经带好 `arguments` / `badArguments`，不需要也不应该自己再解析。
 * @param raw - 事件里的 arguments 原文
 * @returns 参数对象（非法/缺失时为空对象）与无效参数标记
 */
function readArguments(raw: unknown): ArgumentsView {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return { arguments: isRecord(parsed) ? parsed : {}, badArguments: false };
    } catch {
      return { arguments: {}, badArguments: true };
    }
  }
  return { arguments: isRecord(raw) ? raw : {}, badArguments: false };
}

/** 调用类事件（tool/call 与 PTC 子调用开始）→ 记录；其余返回 undefined。 */
function callRecordOf(event: SessionEvent, index: number): ToolCallRecord | undefined {
  // `let record` + 末尾单点 return 不是啰嗦：本仓 oxlint 开了 consistent-return 且
  // treatUndefinedAsUnspecified，`return undefined` 与带值 return 混写即判定失败。
  let record: ToolCallRecord | undefined;
  if (!hasObjectData(event)) {
    return record;
  }
  if (event.type === "tool/call") {
    // 缺可用 name 即坏事件，整条不出行：见 usableName 的理由。callId 仍照旧放宽——它有
    // `nc:<seq>` 回退值，消费方（quality-gate 的 noCallId 组）要的正是那种行。
    const name = usableName(event.data.name);
    if (name !== undefined) {
      const args = readArguments(event.data.arguments);
      record = {
        name,
        callId: usableCallId(event.data.callId),
        arguments: args.arguments,
        badArguments: args.badArguments,
        seq: index,
      };
    }
  } else if (event.type === "tool/ptc-dispatch-start") {
    // PTC 子调用开始与 tool/call 同义，差别有二：串联键由 subCallId 承担，且 arguments
    // 官方是派发前已归一化的 `unknown`（不是 raw JSON 串）。缺失配对键即坏事件：直接
    // 跳过，不给 `nc:` 保守成功待遇——造出假证据会让检查 fail-open（原实现同样处理）。
    const subCallId = usableCallId(event.data.subCallId);
    const name = usableName(event.data.name);
    if (subCallId !== undefined && name !== undefined) {
      const args = readArguments(event.data.arguments);
      record = {
        name,
        callId: subCallId,
        arguments: args.arguments,
        badArguments: args.badArguments,
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
    // usableCallId —— 重放/跨进程边界上送来的坏形状不在类型声明内。
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

/** 一条事件产出的记录行（call 与 result 互斥；非记录事件两位都是 undefined）。 */
export interface ToolEventRows {
  readonly call: ToolCallRecord | undefined;
  readonly result: ToolResultRecord | undefined;
}

/**
 * **单条事件**的记录行（`scanToolEvents` 的一步，也是它唯一的实现处）。
 *
 * 之所以导出：有的消费方要把同一套记录折成投影单元（增量折叠），折叠与"注册表缺席时的全量
 * 扫描"必须逐字同源——两处各写一遍字段读取，就会在两行上给出不同的证据链（那是安全检查的
 * fail-open）。折叠侧传 `event.seq`，扫描侧传数组下标，两者在官方 `seq = log.length` 的连号
 * 约定下是同一个值。
 */
export function toolEventRowsOf(event: SessionEvent, index: number): ToolEventRows {
  return { call: callRecordOf(event, index), result: resultRecordOf(event, index) };
}

/**
 * 扫描事件流 → tool/call 与 tool/result 两张表。
 * 只收集形状可用的事件，其余静默跳过——调用方（检查/证据链）以空表安全回退，不因零星
 * 坏事件抛错。数组空洞（类型声明不可表示、重放数据里却可能出现）同样跳过。
 * seq 取事件在入参数组里的下标（与折叠侧按 seq 归因的语义同一个值）。
 */
export function scanToolEvents(events: readonly SessionEvent[]): {
  calls: ToolCallRecord[];
  results: ToolResultRecord[];
} {
  const calls: ToolCallRecord[] = [];
  const results: ToolResultRecord[] = [];
  // entries() 同时给出下标与元素，省掉手工游标；下标就是记录用的 seq。
  for (const [index, event] of events.entries()) {
    // 空洞与类型声明不可表示的元素（重放数据里的 null、`undefined` 等）整条跳过。
    // `isRecord` 一个判断就够：它对 `undefined` 与 `null` 都返回 false，按字段读取不会 TypeError。
    if (isRecord(event)) {
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
 * {@link editPathOf} 的返回值。按 `kind` 判别联合。
 *
 * 只有两支：**`write` / `read-view`**。取不到路径时仍返回所属那一支、只把 `path` 置为
 * `undefined`——判断依据是工具名与 `command`，与路径取不取得到无关；再多一个 `skip` 只会逼
 * 调用方写出永不执行的分支。路径有没有由 `path === undefined` 表达。
 */
export type EditTarget =
  | { readonly kind: "write"; readonly path: string | undefined }
  | { readonly kind: "read-view"; readonly path: string | undefined };

/**
 * 由 tool/call 记录推导被编辑的文件路径；str_replace_editor 的 view 只读不算写。
 * @returns `write` = 写操作；`read-view` = 只读视图。取不到路径时 `path` 为 `undefined`。
 */
export function editPathOf(call: ToolCallRecord): EditTarget {
  const args = call.arguments;
  if (call.name === "str_replace_editor") {
    return args["command"] === "view"
      ? { kind: "read-view", path: pathOf(args, "path") }
      : { kind: "write", path: pathOf(args, "path") };
  }
  return { kind: "write", path: pathOf(args, "file_path") };
}
