// lib/tool-events.ts —— tool 事件流记录（quality-gate EditAccumulator 与
// danger-guard FactGate 证据链的公共实现，已统一到 shared）。
//
// 共性问题（两插件各自实现同一约定、双份维护）：
//   1. tool/call 的 arguments 官方是模型产出的**原始 JSON 字符串**，而 PTC 子调度的
//      arguments 官方是派发前已 JSON 归一化的 `unknown` —— 两种形态都真实存在，
//      必须按事件来源选择读法（readCallArguments / readPtcArguments），不能从 typeof 猜；
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
// 而不是靠注释照抄 d.ts 行号。PTC 两个变体同为官方面：载荷类型与 `SessionEventMap`
// 增补都来自 `@deepseek-ai/dsh-tool-executor-ptc/types`（官方 types.d.ts 自带那份增补），
// 本包不再自声明。`engines.dsh` 与各 dsh peer 都收在单条 `^0.2.3-alpha.2` 上，窗口里只有
// 这一代宿主；旧 rc 线上「增补换过宿主包」的观察不再作为本地声明的理由，增补仍由官方包自带。
//
// ⚠ PTC 类型面的跨包边界：本包发运的是 dist/types/*.d.ts，官方包
// `@deepseek-ai/dsh-tool-executor-ptc/types` 的裸说明符会存活进
// `dist/types/tool-events.d.ts`。TypeScript 的模块增补按**物理模块身份**生效，shared 里的
// `SessionEventMap` 增补不会自动落到消费仓的类型程序：消费方若要自己构造 PTC 事件
// （测试夹具、自定义执行器）或引用这两个载荷类型，必须自己安装该包，并在本地
// `declare module "@deepseek-ai/dsh-session/types"` 重复一次增补
// （dsh-danger-guard 的 test/fixtures/events.ts 就是现成例子）。
//
// shared 把该包声明为 **optional peer**：只 import `./tool` 的值、不碰 PTC 载荷的消费仓
// 不会被要求安装它；真正引用 PTC 载荷类型、或自己构造 PTC 事件的消费仓，才需要在自己的
// devDependencies 里钉该包并在本地重复一次增补。`skipLibCheck` 会把 d.ts 里解析不到的
// import 静默吞掉，所以“消费仓 tsc 绿”不等于增补在位。增补是否仍在 shared 自己的编译
// 环境里由 test/tool-events-ptc-keys.ts 的键断言钉住；`tool/result.message` 的字段名由
// test/tool-events-message-keys.ts 的编译期断言钉住。

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolErrorInfo } from "@deepseek-ai/dsh-tools";
import { parsePatch } from "@deepseek-ai/dsh-fs-patch";
import { isArrayValue, isRecord } from "./record.ts";

export type { SessionEvent } from "@deepseek-ai/dsh-session";

// PTC 子调度的两个载荷：真源是官方声明（连同它自带的 SessionEventMap 增补），这里只转发名字。
export type {
  PtcDispatchStartEventData,
  PtcDispatchEventData,
} from "@deepseek-ai/dsh-tool-executor-ptc/types";

/**
 * 一条 tool/call 的记录。
 *
 * 字段一律 `readonly`：记录一旦入表就只作证据读，记录被就地改写会让证据链失去意义。
 */
export interface ToolCallRecord {
  /**
   * 调用名（edit/write/str_replace_editor/read/grep/…）——本模块的**分组键**，必选。
   *
   * 官方把它声明成必选 `string`（`tool/call` 见 `packages/core/session/src/types.ts`，
   * PtcDispatchStartEventData.name 见 `packages/core/tool-executor-ptc/src/types.ts`），但运行期拦不住
   * （依据见 usableName）。所以可空性在**扫描层**就处理掉了，不带到类型声明：callRecordOf 遇到
   * 缺可用 name 的调用类事件整条跳过，与 hasObjectData 同一规则。
   *
   * 为什么不把过滤留给消费方：下游分类全建立在 name 上——editPathOf 的 str_replace_editor
   * 只读判定、检查侧的 EDIT_TOOLS 与 refSearchTools 名单——而 editPathOf 的回退分支会把任何
   * 非 str_replace_editor 的调用一律判成 write。无名调用一旦进了记录，只要它的 arguments
   * 里有 file_path 就算成写操作。此前是靠三个消费方各自记得先判一次才没出事——那是同一条
   * 不变式的三份抄本，漏一份就出事；现在这条过滤收在 `callRecordOf` 的入口，消费方不必再抄。
   *
   * 与 callId 的差别是**为什么一个必选、一个可空**：callId 由 usableCallId 回退，且它有
   * `nc:<seq>` 回退值（消费方的 noCallId 组专门收那种行），缺了不影响归类；name 一旦缺了
   * 就没法分组、没有回退值，只能在入口滤掉。
   */
  readonly name: string;
  /** callId：tool/result 串联键；缺失时由调用方按 seq 造 `nc:` 键。 */
  readonly callId: string | undefined;
  /**
   * 解析/快照后的参数对象。对象与从 JSON 文本解析出的对象都会做一次**深快照**：
   * 平台 `structuredClone` 先把参数树与事件完全分离（循环、稀疏数组、Date / Map / Set /
   * ArrayBuffer 视图都由它处理），再对 JSON 普通对象/数组逐层 `Object.freeze`。记录不
   * 别名事件中的任何一层，消费方也改不动 JSON 证据。
   *
   * 非 JSON 对象（Date、Map、TypedArray 等）已被克隆隔离，但内部槽无法由 `Object.freeze`
   * 锁住，不声称冻结；根参数不是普通对象时按空对象处理。函数、Proxy 等不可结构化克隆的
   * 值会让整条参数按空对象处理——工具参数的线上契约是 JSON，畸形输入不得把异常抛进证据链。
   */
  readonly arguments: Readonly<Record<string, unknown>>;
  /**
   * arguments **原文是字符串、且 JSON 语法非法**。
   *
   * 只对 `tool/call` 的原始 JSON 文本成立：PTC 的 arguments 官方已归一化，本模块不在
   * 其上做 JSON.parse，所以永远不会因此置 true。合法 JSON 标量、缺失值、非字符串
   * 非对象都不置 true——消费方对“解析成功却非对象”有自己的记录/跳过策略（例如路径
   * 留空），共享层不替它收紧。调用方据此保留各自语义。
   */
  readonly badArguments: boolean;
  /**
   * 在**入参数组**中的下标（归因/游标用），不是官方事件自带的 `SessionSeq`。
   *
   * 只有扫描从会话起点（下标 0）开始的完整数组时，它才与 `event.seq` 同值；传切片时
   * 是窗口内下标。要跨窗口归因、比较或生成持久键，调用方必须自己加窗口起点偏移。
   */
  readonly seq: number;
}

/**
 * 失败的结构化身份：官方 `tool/result` 与 `tool/ptc-dispatch` 的 `data.error`
 * （`{ name, code, reason? }`，只允许出现在 `isError: true` 的结算旁）。
 *
 * 真源是官方 `ToolErrorInfo`（`@deepseek-ai/dsh-tools` 根导出）；`Readonly` 保住本地
 * 语义——记录一旦入表只作证据读（官方字段本身非 readonly）。错误码是**持久化契约**
 * （官方把 `[name, code]` 记在日志里供消费方比较字符串）；两边改名会在本文件的字段
 * 读取处暴露。
 */
export type ToolErrorIdentity = Readonly<ToolErrorInfo>;

/** 一条 tool/result 的成败。同样只读。 */
export interface ToolResultRecord {
  /**
   * 串联键：`tool/result` 的 `message.source.callId`，或 PTC 的 `subCallId`。必填。
   *
   * 事件扫描层遇到缺失/空串/非字符串的配对键会**整条不出行**：没有键的结算无法归属，
   * 留在表里只会被下游当成“已结算”。消费方的 `nc:<seq>` 回退只针对调用行，不针对结算行。
   */
  readonly callId: string;
  readonly isError: boolean;
  /**
   * 失败身份：只在 `isError` 为真时保留。`isError: false` 的记录不会带 error——
   * 官方把 `data.error` 限定在失败结算旁，共享层不产出“成功但带失败身份”的矛盾记录。
   * 缺失是正常情况（旧宿主、守卫拒绝、工具体抛出的普通错误都不带身份），
   * 消费方必须把它当成“没有分类”而不是成功。
   */
  readonly error: ToolErrorIdentity | undefined;
  readonly seq: number;
}

/**
 * 读 `tool/result` 的成败位：`isError` 缺省或 false = 成功（官方 `isError?: boolean`），
 * true = 失败；非布尔是坏形状，返回 undefined 让整条结算不出行（不能把未知当成功）。
 */
function readIsError(raw: unknown): boolean | undefined {
  let result: boolean | undefined;
  if (isRecord(raw)) {
    const value = raw["isError"];
    if (value === undefined || value === false) {
      result = false;
    } else if (value === true) {
      result = true;
    }
  }
  return result;
}

/**
 * 读一次失败身份：`name` 与 `code` 都必须是**非空字符串**才认。
 *
 * 为什么要这么严：`data.error` 进入的是持久化日志，跨进程与重放数据都可能送来半截形状；
 * 缺 `code` 的身份无法按官方契约比较，缺 `name` 的只剩一个孤立码。把半截形状当成身份，
 * 下游的分类（例如"被拒绝的编辑没有写过文件"）就会建立在一份不完整的证据上。
 * `reason` 只收字符串；缺失或非字符串时整个字段不出现（保持可选字段的原始形状）。
 * @param raw - 事件里的 `data.error`
 * @returns 可用的失败身份，或 undefined（缺失/畸形）
 */
function usableErrorIdentity(raw: unknown): ToolErrorIdentity | undefined {
  let identity: ToolErrorIdentity | undefined;
  if (isRecord(raw)) {
    const { name, code, reason } = raw;
    if (typeof name === "string" && name !== "" && typeof code === "string" && code !== "") {
      identity = typeof reason === "string" ? { name, code, reason } : { name, code };
    }
  }
  return identity;
}

/** 官方保证每个事件必带对象 `data`。这里仍校验：扫描器跑在检查/证据链的同步路径上，
 *  约定是「零星坏事件静默跳过、不抛错」，而重放或跨边界数据可以送来临时缺 data 的事件。
 *  类型声明已把 data 记为必选，所以这个检查在 TS 里是永远成立——它防的是类型外的输入。
 *  参数允许 null/undefined：`toolEventRowsOf` 也接受重放数据里的坏元素。 */
function hasObjectData(event: SessionEvent | null | undefined): event is SessionEvent {
  return isRecord(event) && isRecord(event.data);
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
 * 官方把它声明成必选 `string`（`tool/call` 见 `packages/core/session/src/types.ts`，
 * PtcDispatchStartEventData.name 见 `packages/core/tool-executor-ptc/src/types.ts`），但**运行期拦不住**：
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
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly badArguments: boolean;
}

/** 只认普通对象作为 JSON 参数树的容器；Date / Map / 类实例不在工具参数的 JSON 契约内。 */
function isPlainRecord(value: object): boolean {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 冻结 JSON 参数树：只走普通对象/数组，逐层 `Object.freeze`。循环用 `WeakSet` 挡住。
 *
 * 非 JSON 对象（Date / Map / Set / TypedArray）不再向下钻：它们已经被 `structuredClone`
 * 与原事件分离，但内部槽无法由 `Object.freeze` 锁住，不能假装冻结。工具参数来自 JSON，
 * 这一支只在畸形/测试输入里出现。
 */
function freezeSnapshot(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  if (!isArrayValue(value) && !isPlainRecord(value)) {
    return;
  }
  seen.add(value);
  for (const nested of Object.values(value) as unknown[]) {
    freezeSnapshot(nested, seen);
  }
  Object.freeze(value);
}

/**
 * 深快照：克隆交给平台 `structuredClone`，再对 JSON 参数树逐层冻结。
 *
 * 参考 lodash `baseClone` / `cloneDeep` 的边界后不再手写递归复制：循环引用、稀疏数组、
 * `__proto__` 自有键、Date / Map / Set / ArrayBuffer 视图都由平台算法覆盖，避免自写
 * 克隆在这些形状上产生偏差。`structuredClone` 对函数、Proxy 等不可结构化值会抛
 * `DataCloneError`，这里按空参数处理——工具参数的线上契约是 JSON，畸形输入不应把异常
 * 抛进证据链。
 */
function snapshotArguments(raw: Record<string, unknown>): Readonly<Record<string, unknown>> {
  try {
    const snapshot = structuredClone(raw);
    if (!isPlainRecord(snapshot)) {
      return {};
    }
    freezeSnapshot(snapshot, new WeakSet<object>());
    return snapshot;
  } catch {
    return {};
  }
}

/**
 * 读 `tool/call` 的 arguments：官方是模型产出的**原始 JSON 文本**；对象形态是防御性兼容。
 *
 * 无效参数标记与解析必须同一次读：两件事都建立在「JSON.parse 抛没抛」上，拆成两个函数就得把
 * 同一串 JSON 解析两遍（同一份入参两次解析，第一次的抛错与否恰好决定第二次的结论）。
 * 判断是「仅当字符串 JSON **语法非法**」——合法 JSON 非对象（`"42"`）、undefined/数字/对象
 * 一律不标：既有消费方对 JSON.parse 抛错判"不入记录"，但对"解析成功却非对象"仍记录（路径
 * 留空）。不能把"非对象"也划进无效参数：多划进去一种，等于替消费方改了检查的宽严。
 *
 * 模块私有：`tool/call` 的记录经 `callRecordOf` 走这一处，外部消费方拿到的
 * `toolEventRowsOf` 记录里已经带好 `arguments` / `badArguments`，不需要也不应该自己再解析。
 * @param raw - 事件里的 arguments 原文
 * @returns 参数对象（非法/缺失时为空对象）与无效参数标记
 */
function readCallArguments(raw: unknown): ArgumentsView {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return {
        arguments: isRecord(parsed) ? snapshotArguments(parsed) : {},
        badArguments: false,
      };
    } catch {
      return { arguments: {}, badArguments: true };
    }
  }
  return {
    arguments: isRecord(raw) ? snapshotArguments(raw) : {},
    badArguments: false,
  };
}

/**
 * 读 PTC 的 arguments：官方在派发前已做 JSON 归一化（`jsonNormalizeArgs`），值可能是
 * 对象、数组、字符串、数字等**合法 JSON 值**，**不是待解析的 JSON 文本**。
 *
 * 这里只接受对象作为参数映射；非对象回空对象且**不**标 badArguments——PTC 的字符串若再
 * `JSON.parse` 一次，会把 `'{"file_path":"a.ts"}'` 误当对象、把 `"hello"` 误标成语法错误。
 * 参数格式由事件来源决定，不能从 `typeof raw === "string"` 推断。
 */
function readPtcArguments(raw: unknown): ArgumentsView {
  return {
    arguments: isRecord(raw) ? snapshotArguments(raw) : {},
    badArguments: false,
  };
}

/** 调用类事件（tool/call 与 PTC 子调用开始）→ 记录；其余返回 undefined。
 *  调用方（`toolEventRowsOf`）已用 `hasObjectData` 收窄，这里不再重复校验 data。 */
function callRecordOf(event: SessionEvent, index: number): ToolCallRecord | undefined {
  // `let record` + 末尾单点 return 不是啰嗦：本仓 oxlint 开了 consistent-return 且
  // treatUndefinedAsUnspecified，`return undefined` 与带值 return 混写即判定失败。
  let record: ToolCallRecord | undefined;
  if (event.type === "tool/call") {
    // 缺可用 name 即坏事件，整条不出行：见 usableName 的理由。callId 仍照旧放宽——它有
    // `nc:<seq>` 回退值，消费方（quality-gate 的 noCallId 组）要的正是那种行。
    const name = usableName(event.data.name);
    if (name !== undefined) {
      const args = readCallArguments(event.data.arguments);
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
    // 官方是派发前已归一化的 `unknown`（不是 raw JSON 串）——按来源走 readPtcArguments，
    // 不把合法的字符串值再 JSON.parse 一遍。缺失配对键即坏事件：直接跳过，不给 `nc:`
    // 保守成功待遇——造出假证据会让检查 fail-open（原实现同样处理）。
    const subCallId = usableCallId(event.data.subCallId);
    const name = usableName(event.data.name);
    if (subCallId !== undefined && name !== undefined) {
      const args = readPtcArguments(event.data.arguments);
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

type ToolResultEvent = Extract<SessionEvent, { type: "tool/result" }>;
type PtcDispatchEvent = Extract<SessionEvent, { type: "tool/ptc-dispatch" }>;

/** `tool/result` 分支：`message.isError` 缺省/false=成功，非布尔=坏形状；无配对键亦坏。 */
function toolResultRecordOf(event: ToolResultEvent, index: number): ToolResultRecord | undefined {
  // 官方 `data.message` 必选、类型是 ToolResultMessage；仍按 unknown 读，理由见
  // usableCallId —— 重放/跨进程边界上送来的坏形状不在类型声明内。
  const message: unknown = event.data.message;
  const source = isRecord(message) ? message["source"] : undefined;
  const callId = isRecord(source) ? usableCallId(source["callId"]) : undefined;
  const isError = readIsError(message);
  return callId !== undefined && isError !== undefined
    ? {
        callId,
        isError,
        error: isError ? usableErrorIdentity(event.data.error) : undefined,
        seq: index,
      }
    : undefined;
}

/** PTC 分支：`isError` 官方必选 boolean，缺位/非布尔=坏形状，不能按成功。 */
function ptcDispatchRecordOf(event: PtcDispatchEvent, index: number): ToolResultRecord | undefined {
  const { subCallId: rawSubCallId, isError } = event.data;
  const subCallId = usableCallId(rawSubCallId);
  return subCallId !== undefined && typeof isError === "boolean"
    ? {
        callId: subCallId,
        isError,
        error: isError ? usableErrorIdentity(event.data.error) : undefined,
        seq: index,
      }
    : undefined;
}

/**
 * 结算类事件（tool/result 与 PTC 子调度结算）→ 成败记录；其余返回 undefined。
 *
 * 两条分支的“可用”判据不同，不能合并：
 *  - `tool/result`：`message.isError` 是**可选** boolean（官方 `isError?: boolean`），
 *    缺省或 false 都是成功；非布尔是坏形状。
 *  - `tool/ptc-dispatch`：`isError` 是**必选** boolean，缺位/非布尔是坏形状，不能按成功。
 * 没有配对键、或成败位不可用的结算整条不出行：消费方把“未配对”当未知，才不会把
 * 一条坏结算当成成功证据。
 *
 * `data.error` 只在 `isError` 为真时读取，保证记录不会出现 `{ isError: false, error }`。
 */
function resultRecordOf(event: SessionEvent, index: number): ToolResultRecord | undefined {
  let record: ToolResultRecord | undefined;
  if (event.type === "tool/result") {
    record = toolResultRecordOf(event, index);
  } else if (event.type === "tool/ptc-dispatch") {
    record = ptcDispatchRecordOf(event, index);
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
 * fail-open）。
 *
 * `index` 是调用方希望写进记录的“序”：折叠侧传 `event.seq`，扫描侧传数组下标。
 * 只有数组从会话起点（下标 0）开始时两者才同值；窗口切片的下标是局部的，要跨窗口
 * 归因请由调用方加窗口起点偏移（本函数不替调用方猜）。
 *
 * `event` 允许 `null` / `undefined`：重放数据里的坏元素返回两位 undefined，不抛错。
 */
export function toolEventRowsOf(
  event: SessionEvent | null | undefined,
  index: number,
): ToolEventRows {
  if (!hasObjectData(event)) {
    return { call: undefined, result: undefined };
  }
  return { call: callRecordOf(event, index), result: resultRecordOf(event, index) };
}

/**
 * 扫描事件流 → tool/call 与 tool/result 两张表。
 * 只收集形状可用的事件，其余静默跳过——调用方（检查/证据链）以空表安全回退，不因零星
 * 坏事件抛错。数组空洞（类型声明不可表示、重放数据里却可能出现）同样跳过。
 *
 * `seq` 取事件在入参数组里的**局部下标**，不是会话序号；只有传入从 0 开始的完整数组时
 * 才与 `event.seq` 同值。窗口切片消费方若要把记录当全局证据，需自行加窗口偏移。
 *
 * 本函数只产出两张表，**不验证配对**；普通 `callId` 与 PTC `subCallId` 共用同一个字符串
 * 字段。窗口边界上的调用/结算可能各自孤立，消费方必须把“未配对”当未知而不是成功。
 */
export function scanToolEvents(events: readonly SessionEvent[]): {
  calls: ToolCallRecord[];
  results: ToolResultRecord[];
} {
  const calls: ToolCallRecord[] = [];
  const results: ToolResultRecord[] = [];
  // entries() 同时给出下标与元素，省掉手工游标；下标就是记录用的 seq。
  for (const [index, event] of events.entries()) {
    // 空洞与类型声明不可表示的元素（重放数据里的 null、`undefined` 等）由公共入口
    // 统一校验，不在扫描循环里另写一遍。
    const { call, result } = toolEventRowsOf(event, index);
    if (call !== undefined) {
      calls.push(call);
    }
    if (result !== undefined) {
      results.push(result);
    }
  }
  return { calls, results };
}

function pathOf(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
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
 * 一条 `apply_patch` 补丁操作的目标。`moveTo` 只出现在 update 上；源路径与目的路径
 * 都是文件效应，调用方需要分别记录。
 */
export interface ApplyPatchTarget {
  readonly kind: "add" | "update" | "delete";
  readonly path: string;
  readonly moveTo?: string;
}

/**
 * 从 `apply_patch` 的 `{ input }` 解析有序操作。解析器是官方 `dsh-fs-patch` 的同一份
 * `parsePatch`：host 执行什么语法，这里就认什么，不另写一套会与宿主漂移的补丁文法。
 * 非补丁输入、或宿主解析器拒绝的补丁一律交回空数组；调用方按工具名决定是否 fail-closed。
 */
export function applyPatchTargetsOf(
  args: Readonly<Record<string, unknown>> | undefined | null,
): readonly ApplyPatchTarget[] {
  const input = args?.["input"];
  if (typeof input !== "string" || !input.includes("*** Begin Patch")) {
    return [];
  }
  try {
    return parsePatch(input).map((operation) => {
      if (operation.kind !== "update") {
        return { kind: operation.kind, path: operation.path };
      }
      return operation.moveTo === undefined
        ? { kind: "update" as const, path: operation.path }
        : { kind: "update" as const, path: operation.path, moveTo: operation.moveTo };
    });
  } catch {
    return [];
  }
}

/**
 * 由 tool/call 记录推导被编辑的文件路径；str_replace_editor 的 view 只读不算写。
 *
 * 调用方必须**先按工具名筛选**：除 `apply_patch` / `str_replace_editor` 外的所有名字都按
 * write 读 `file_path`，一个未筛选的 read/grep 调用也会得到 `{ kind: "write", path }`。
 * `apply_patch` 只取第一条操作路径，多目标调用/全文件检查请走 {@link editPathsOf}。
 * @returns `write` = 写操作；`read-view` = 只读视图。取不到路径时 `path` 为 `undefined`。
 */
export function editPathOf(call: ToolCallRecord): EditTarget {
  const args = call.arguments;
  if (call.name === "apply_patch") {
    return { kind: "write", path: applyPatchTargetsOf(args)[0]?.path };
  }
  if (call.name === "str_replace_editor") {
    return args["command"] === "view"
      ? { kind: "read-view", path: pathOf(args, "path") }
      : { kind: "write", path: pathOf(args, "path") };
  }
  return { kind: "write", path: pathOf(args, "file_path") };
}

/**
 * 一次 tool/call 的全部写目标（去重、保持补丁顺序）。`apply_patch` 的 move 同时交回
 * 源路径与目的路径：前者被删除、后者被创建，两处都必须能被下游看见。
 *
 * 返回的是**请求操作的路径**，不是磁盘变更证明；空数组也不等于“没有写操作”
 * （view、写调用缺路径、补丁解析失败都可能为空）。调用方要按工具名决定是否 fail-closed，
 * 不能仅凭空表就认定这次调用没写过。
 */
export function editPathsOf(call: ToolCallRecord): readonly string[] {
  if (call.name === "apply_patch") {
    const paths = applyPatchTargetsOf(call.arguments).flatMap((target) =>
      target.kind === "update" && target.moveTo !== undefined
        ? [target.path, target.moveTo]
        : [target.path],
    );
    // 保序去重：Set 记住已见值，最坏 O(n)。原来的 filter + indexOf 在长补丁上是二次方。
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const value of paths) {
      if (value.length > 0 && !seen.has(value)) {
        seen.add(value);
        unique.push(value);
      }
    }
    return unique;
  }
  const target = editPathOf(call);
  return target.kind === "write" && target.path !== undefined ? [target.path] : [];
}
