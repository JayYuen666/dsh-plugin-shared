// lib/decorator-lowering.ts —— 标准装饰器（TC39）的**预转换**：构建与测试两条流水线共用这一份。
//
// 为什么需要它（每一步都实测过）：
//  1. 官方 Typert Remote **只能用标准装饰器声明**：`remoteMethods()` 只读 `@Remote` 写在原型上的
//     那个描述符；而 `Remote` 的实现对 legacy 签名直接抛（`context === undefined` 那条分支 +
//     读 `context.addInitializer`），所以 legacy 降级也不行。
//  2. 两条流水线的解析器**都不降级标准装饰器**：rolldown/oxc 的 `DecoratorOptions` 只有 `legacy`
//     与 `emitDecoratorMetadata` 两个开关（"predates the TC39 standardization process"），实测它把
//     `@Remote("stats")` **原样吐进产物** —— 那是一段**非法 JS**，插件在宿主里会直接加载失败，
//     而**构建报成功**。vitest 侧更直接：`SyntaxError: Invalid or unexpected token`。
//  3. 进程内的替代入口也没有：本工作区的 TS 是 7.x（原生重写版），它的 JS 面上只有 `version`
//     （`transpileModule === undefined`）。上游靠 `ts.transpileModule` 是因为它用 TS 6。
//  4. 剩下的可行入口是 **`tsc` CLI 本身**（它就是那个编译器）：实测它对标准装饰器产出完整的
//     `__esDecorate(this, null, _stats_decorators, { kind: "method", … })` —— 正是 `Remote` 要的签名。
//
// 所以本模块跑一次 `tsc`，把**单个**带装饰器的文件编译成 JS 交给流水线。
//
// ⚠ tsc 入口由**调用方注入**（`tscEntry`）：typescript 是各包自己的 devDependency，只有按调用方
// 的依赖图 resolve 才不依赖提升布局。这与 `./build-types.ts` 的 `TypesBuildOptions.tscEntry`
// 是同一条纪律 —— 本包是 provider，不能替消费方决定它装的是哪一份 typescript。
// 同一条纪律也适用于装饰器判据的解析器（`parseAst`）：它来自调用方的 rolldown，本包不为构建
// 工具声明运行期依赖。判据与 tsc 产物里“哪些行是编译器注入的”都靠它，所以 `lowerStandardDecorators`
// 也需要它。
//
// ⚠ **编译的是 `code` 本身，不是磁盘上的原文**：先把 `code` 写进临时目录里同后缀的源文件，再让
// tsc 编它。这样判据输入、编译输入与 `sourcesContent` 是同一份文本；上游 transform 改过的文本
// 或虚拟模块不会出现“对 B 判装饰器、把 B 写进 sourcesContent、让 tsc 编 A”的分裂。临时文件只
// 用来给 tsc 一个可读路径：`--noResolve` 让模块说明符逐字保留，产物仍按原模块 id 交给流水线。
//
// ⚠ `--noResolve` 不是可选项：不加它 tsc 会**顺着 import 把整张图都编译一遍**，而复用它的产物
// 等于让流水线吃两份源码。带上它之后 tsc 只编这一个文件，且**模块说明符逐字保留**
// （`from "./judge-stats.ts"` —— 流水线的 `.ts` 解析照常）。
//
// ⚠ `--noCheck` 也不是可选项：`--noResolve` 下每个 import 都会报一条 TS2307（"找不到模块"）。
// 不用 `--noCheck` 时这条必然诊断会把退出码变成非零，于是“退出码”整条信息作废，只能退化成
// “产物文件出来了就算成功”。`--noCheck` 只保留 parse/emit 级错误（TS 7.0.2 实测），退出码因此
// 重新可信：非零就是真失败，不再靠猜。代价是类型错误不再在这里报——本模块只负责发射，类型面
// 由各包自己的 `tsc --noEmit` 负责。
//
// ⚠ 这一步是**同步**的（`spawnSync`）且成功路径不往终端写任何字节：构建与测试的日志必须干净。
// stdout/stderr 只在失败时拼进错误消息；成功时即使 tsc 有输出也不打印。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { walkAst } from "./ast-walk.ts";
import { isRecord } from "./record.ts";

/** 单文件 TS 解析器：返回 oxc 的 `Program`（这里只做结构遍历，不依赖具体节点类型）。
 *  rolldown 的 `parseAst(code, { lang: "ts" }, id)` 满足这个形状，由调用方注入。
 *
 *  两个用途：判据（源码里有没有装饰器）与产物识别（哪几行是 tsc 注入的样板）。
 *  对后者传的是 tsc 写出的 JS —— 它是 TS 的子集，同一个解析器可以吃。
 *
 *  **解析失败必须抛错**：返回空 AST 或带 `errors` 的 Program 都会让判据静默漏掉装饰器，
 *  构建把非法 JS 当成功写出去。rolldown 的 `parseAst` 适配器已在 `errors.length > 0` 时抛错。 */
export type ParseSourceAst = (code: string, id: string) => unknown;

/** 预转换的执行链入参：只描述 tsc 入口。 */
export interface LoweringToolchain {
  /** tsc 入口脚本的绝对路径（用 `process.execPath` 跑它，跨平台且不经 PATH / npx）。 */
  readonly tscEntry: string;
}

/** 预转换的入参：判定与产物识别要解析器，执行要 tsc 入口。 */
export interface DecoratorLoweringOptions extends LoweringToolchain {
  /** 注入的解析器：判断源码里有没有装饰器，并识别 tsc 产物里的注入行。 */
  readonly parseAst: ParseSourceAst;
}

/** 临时目录前缀（`mkdtempSync` 会在它后面追加随机段）。 */
const TMP_PREFIX = "dsh-decorators-";

/** 声明文件不产出 JS：`.d.ts` / `.d.mts` / `.d.cts` 一律不进预转换。 */
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

/** TS 源后缀（`.ts` / `.mts` / `.cts`）。 */
const TS_FILE = /\.[cm]?ts$/u;

/** tsc 产物文件尾的源映射注释。只允许删**最后一条非空行**：模板字符串里也可能出现同形文本。 */
const SOURCE_MAP_MARK = "//# sourceMappingURL=";

/** tsc 注入的装饰器调用：类静态块里的 `__esDecorate(…)`。
 *
 *  刻意**不含** `__runInitializers(`：字段初始化里的那一行会把 `compute()` 这类手写表达式
 *  作为实参一起写在同一行（`x = __runInitializers(this, _x_initializers, compute());`）。
 *  整行去映射会连手写表达式一起摘掉；而 `__runInitializers` 本身不引入新函数，构造器/字段
 *  初始化未执行时那本来就是真实的未覆盖行。 */
const ES_DECORATE = "__esDecorate";

/** 标准装饰器支持的节点之外，唯一会带 `decorators` 的 legacy 位置。
 *  碰到这些节点不能“照样降级”：tsc 的标准装饰器语义会报 TS1206 但**仍然发射**一份把装饰器
 *  整条丢掉的 JS（实测），当前实现如果只看“产物非空”就会静默改变语义。 */
const UNSUPPORTED_PARAMETER_DECORATOR_NODES: ReadonlySet<string> = new Set([
  "TSParameterProperty",
  "Identifier",
  "FormalParameter",
  "RestElement",
  "AssignmentPattern",
]);

/** 源映射里的一段。`sourceIndex` 等为 null 表示这一段只有 generated column（合法的一字段段）。 */
interface MappingSegment {
  readonly generatedColumn: number;
  readonly sourceIndex: number | null;
  readonly sourceLine: number | null;
  readonly sourceColumn: number | null;
  readonly nameIndex: number | null;
}

/** tsc 产物与源映射（`map` 为 null 表示构建路径允许源映射缺席）。 */
export interface LoweredDecorators {
  readonly code: string;
  readonly map: SourceMapText | null;
}

/** 源映射的形状（只保留本模块真正读写的字段）。 */
interface SourceMapText {
  version: number;
  sources: string[];
  sourcesContent?: string[];
  mappings: string;
  names?: string[];
}

/** 判据结果：有没有装饰器、以及有没有标准装饰器不支持的位置。 */
interface DecoratorInspection {
  readonly hasDecorator: boolean;
  readonly unsupportedNode: string | null;
}

/** tsc 产物里由编译器注入、需要从**测试路径的源映射**中摘掉的行。 */
interface PlumbingLines {
  /** `if (_metadata) Object.defineProperty(…, Symbol.metadata, …)` 所在行。 */
  readonly metadata: ReadonlySet<number>;
  /** 类静态块里的 `__esDecorate(…)` 所在行。 */
  readonly esDecorate: ReadonlySet<number>;
}

/** 一次 tsc 调用的诊断输出（成功路径也收着，失败时拼进错误）。 */
interface TscRun {
  readonly stdout: string;
  readonly stderr: string;
}

/** 去掉文件尾 sourceMappingURL 注释后的产物与那条注释的原始行号。 */
interface StrippedCode {
  readonly code: string;
  readonly line: number | null;
}

/**
 * AST 里有没有装饰器，以及有没有标准装饰器不支持的位置。
 *
 * 只做结构遍历：不依赖 oxc 的具体节点类名，也不跟随节点之外的引用（用 seen 防环）。
 * 取「任一节点的 decorators 数组非空」而不是按类名列举：标准装饰器可以挂在类、方法、字段、
 * accessor 上；参数位置（`TSParameterProperty` 等）是 legacy 语义，标准降级会把它整条丢掉，
 * 所以单独判出来并当场拒绝，不能让它走到 tsc。
 * @param ast - 解析器交回的 Program
 * @returns 判据结果
 */
function inspectDecorators(ast: unknown): DecoratorInspection {
  let hasDecorator = false;
  let unsupportedNode: string | null = null;
  walkAst(ast, (node) => {
    const { decorators, type } = node;
    if (!Array.isArray(decorators) || decorators.length === 0) {
      return false;
    }
    hasDecorator = true;
    if (typeof type === "string" && UNSUPPORTED_PARAMETER_DECORATOR_NODES.has(type)) {
      unsupportedNode = type;
      return true;
    }
    return false;
  });
  return { hasDecorator, unsupportedNode };
}

/**
 * 这个文件需要预转换吗（声明文件、后缀与装饰器节点三道筛）。
 *
 * 装饰器判据走**解析器的 AST**，不再用文本遮蔽：遮蔽器不识别正则字面量，
 * `const r = /"/;` 会让它把其后的正文一并遮掉，阴性结果于是变成「没有装饰器」——
 * 该文件带着 `@dec` 直接进流水线，产物是非法 JS 而构建报成功（实测复现过）。
 * AST 判据没有这个反向漏报面；注释与字符串里的 `@` 本来就不是装饰器节点。
 *
 * 参数位置上的装饰器是 legacy 语义：标准装饰器不支持它，tsc 会在报 TS1206 后仍然发射一份
 * 把装饰器丢掉的 JS。这里当场拒绝，避免“构建成功、运行期装饰器消失”。
 * @param id - 模块 id（可能带 query，调用方负责剥）
 * @param code - 源文本
 * @param parseAst - 注入的单文件解析器
 * @returns 需要预转换时为真
 */
export function needsDecoratorLowering(
  id: string,
  code: string,
  parseAst: ParseSourceAst,
): boolean {
  if (!TS_FILE.test(id) || DECLARATION_FILE.test(id)) {
    return false;
  }
  let ast: unknown;
  try {
    ast = parseAst(code, id);
  } catch (error) {
    // 解析不了就无法回答「有没有装饰器」。这里不许猜：返回 false 会让一个带装饰器的
    // 文件在判据这一步被静默放过，产物于是又变成非法 JS；而返回 true 会先跑一次必然
    // 失败的 tsc，把真正的语法错误盖成「tsc 没产出」。当场抛，并保留解析器给的原始错因。
    throw new Error(`解析 ${id} 失败（装饰器预转换的判据）：${String(error)}`, { cause: error });
  }
  const inspection = inspectDecorators(ast);
  if (inspection.unsupportedNode !== null) {
    throw new Error(
      `dsh-plugin-shared: 标准装饰器不支持参数装饰器（${inspection.unsupportedNode}，${id}）。` +
        "参数装饰器属于 legacy 语义，tsc 的标准装饰器降级会报 TS1206 后仍然发射一份丢掉该装饰器的 JS；" +
        "请改用程序化 markRemote，或移除这个参数装饰器。",
    );
  }
  return inspection.hasDecorator;
}

/**
 * 源文件后缀 → tsc 为它产出的 JS 后缀。
 *
 * 后缀门槛接受 `.mts` / `.cts`，而 tsc 对它们的产物是 `.mjs` / `.cjs`（不是 `.js`）。
 * @param file - 源文件路径
 * @returns 产物后缀
 */
function emittedExtensionOf(file: string): string {
  if (file.endsWith(".mts")) {
    return ".mjs";
  }
  return file.endsWith(".cts") ? ".cjs" : ".js";
}

/**
 * 源文件后缀（决定临时文件的模块格式）；声明文件与非 TS 输入当场拒绝。
 * @param file - 源文件路径
 * @returns `.ts` / `.mts` / `.cts`
 */
function sourceExtensionOf(file: string): ".ts" | ".mts" | ".cts" {
  if (DECLARATION_FILE.test(file)) {
    throw new Error(`dsh-plugin-shared: 声明文件不参与装饰器降级（${file}）`);
  }
  if (file.endsWith(".mts")) {
    return ".mts";
  }
  if (file.endsWith(".cts")) {
    return ".cts";
  }
  if (file.endsWith(".ts")) {
    return ".ts";
  }
  throw new Error(`dsh-plugin-shared: 装饰器降级只接受 .ts/.mts/.cts（收到 ${file}）`);
}

/**
 * 只删最后一条非空行上的 sourceMappingURL 注释。
 *
 * 不能按 `line.startsWith` 扫全文件：合法模板字符串里的一行也可能以同形文本开头，整行清空
 * 会直接改字符串值。tsc 的这条注释固定在文件尾，所以从尾部往前找第一条非空行即可。
 * @param code - tsc 产物
 * @returns 去掉注释后的产物与注释所在行号（没有则为 null）
 */
function stripTrailingSourceMapComment(code: string): StrippedCode {
  const lines = code.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line !== undefined && line.trim() !== "") {
      if (!line.startsWith(SOURCE_MAP_MARK)) {
        break;
      }
      lines[index] = "";
      return { code: lines.join("\n"), line: index };
    }
  }
  return { code, line: null };
}

/** 每个生成行起点在字符串里的偏移（用于把 AST 的 start/end 换成行号）。 */
function lineStartsOf(code: string): number[] {
  const starts: number[] = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

/**
 * 偏移 → 0 基行号。用从后往前的线性扫描：产物只有几百行，节点也只有几枚，没必要二分。
 * @param starts - {@link lineStartsOf} 的结果
 * @param offset - 字符偏移
 * @returns 0 基行号
 */
function lineOfOffset(starts: readonly number[], offset: number): number {
  return Math.max(
    0,
    starts.findLastIndex((start) => start <= offset),
  );
}

/** 节点是不是指定名字的 `Identifier`。 */
function isIdentifier(value: unknown, name: string): boolean {
  return isRecord(value) && value["type"] === "Identifier" && value["name"] === name;
}

/** 节点是不是 `object.property` 形状的非计算成员表达式。 */
function isMemberExpression(value: unknown, objectName: string, propertyName: string): boolean {
  if (!isRecord(value) || value["type"] !== "MemberExpression") {
    return false;
  }
  return (
    value["computed"] !== true &&
    isIdentifier(value["object"], objectName) &&
    isIdentifier(value["property"], propertyName)
  );
}

/** 表达式是不是 `Object.defineProperty(…, Symbol.metadata, …)`。 */
function isMetadataPublishExpression(value: unknown): boolean {
  if (!isRecord(value) || value["type"] !== "CallExpression") {
    return false;
  }
  if (!isMemberExpression(value["callee"], "Object", "defineProperty")) {
    return false;
  }
  const args = value["arguments"];
  return Array.isArray(args) && args.some((arg) => isMemberExpression(arg, "Symbol", "metadata"));
}

/** 是不是 `if (_metadata) Object.defineProperty(…, Symbol.metadata, …);`（单行或带 block 都认）。 */
function isMetadataPublish(value: Record<string, unknown>): boolean {
  const { type, test, consequent } = value;
  if (type !== "IfStatement" || !isIdentifier(test, "_metadata") || !isRecord(consequent)) {
    return false;
  }
  const { type: consequentType, expression, body } = consequent;
  if (consequentType === "ExpressionStatement") {
    return isMetadataPublishExpression(expression);
  }
  if (consequentType !== "BlockStatement" || !Array.isArray(body)) {
    return false;
  }
  return body.some((item) => {
    if (!isRecord(item)) {
      return false;
    }
    const { type: itemType, expression: itemExpression } = item;
    return itemType === "ExpressionStatement" && isMetadataPublishExpression(itemExpression);
  });
}

/** 是不是 tsc 注入的 `__esDecorate(…)` 调用。 */
function isEsDecorateCall(value: Record<string, unknown>): boolean {
  const { type, callee } = value;
  return type === "CallExpression" && isIdentifier(callee, ES_DECORATE);
}

/**
 * 解析 tsc 产物，找出编译器注入的 metadata 发布句与 `__esDecorate` 调用所在的行。
 *
 * 不用文本锚点：合法模板字符串里可以出现完全相同的语句文本，按行扫会把字符串值改掉。
 * AST 只认真正的 `IfStatement` / `CallExpression`，字符串与注释天然出局。
 * @param js - tsc 产物
 * @param parseAst - 注入的解析器
 * @param id - 源文件 id（用于错误消息）
 * @returns 注入行的 0 基行号集合
 */
function generatedPlumbingLines(js: string, parseAst: ParseSourceAst, id: string): PlumbingLines {
  let ast: unknown;
  try {
    ast = parseAst(js, id);
  } catch (error) {
    throw new Error(
      `dsh-plugin-shared: 解析 tsc 产物失败，无法识别装饰器样板（${id}）：${String(error)}`,
      { cause: error },
    );
  }
  const starts = lineStartsOf(js);
  const metadata = new Set<number>();
  const esDecorate = new Set<number>();
  const addNodeLines = (target: Set<number>, node: Record<string, unknown>): void => {
    const { start, end } = node;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) {
      return;
    }
    const first = lineOfOffset(starts, start);
    const last = lineOfOffset(starts, end - 1);
    for (let line = first; line <= last; line += 1) {
      target.add(line);
    }
  };
  walkAst(ast, (node) => {
    if (isEsDecorateCall(node)) {
      addNodeLines(esDecorate, node);
    } else if (isMetadataPublish(node)) {
      addNodeLines(metadata, node);
    }
    return false;
  });
  return { metadata, esDecorate };
}

/** base64 字母表（Source Map v3 的 VLQ 用）。 */
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 字符 → 6 位值；只建一次。 */
const BASE64_VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(BASE64_ALPHABET, (char, index) => [char, index] as const),
);

/**
 * 解一个 VLQ 值。
 * @param segment - 当前段文本
 * @param start - 起始字符下标
 * @returns 解出的值与下一个字符下标
 */
function decodeVlq(segment: string, start: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    const char = segment[index];
    if (char === undefined) {
      throw new Error(`dsh-plugin-shared: 源映射段被截断：${segment}`);
    }
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined) {
      throw new Error(`dsh-plugin-shared: 源映射里有非法 base64 字符：${char}`);
    }
    index += 1;
    // 低 5 位是值，第 6 位（32）是继续位。用算术而不是位运算，避免大偏移被截成 32 位。
    result += (digit % 32) * 2 ** shift;
    if (digit < 32) {
      break;
    }
    shift += 5;
  }
  const negative = result % 2 === 1;
  const magnitude = Math.floor(result / 2);
  return { value: negative ? -magnitude : magnitude, next: index };
}

/**
 * 把一个整数编成 VLQ。
 * @param value - 有符号整数
 * @returns base64 VLQ 文本
 */
function encodeVlq(value: number): string {
  let remaining = value < 0 ? -value * 2 + 1 : value * 2;
  let output = "";
  do {
    let digit = remaining % 32;
    remaining = Math.floor(remaining / 32);
    if (remaining > 0) {
      digit += 32;
    }
    output += BASE64_ALPHABET.charAt(digit);
  } while (remaining > 0);
  return output;
}

/** 源映射差分状态：source / 原始坐标 / name 的基准跨生成行延续。 */
interface MappingState {
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex: number;
}

/**
 * 解一段（一行里的一个逗号分隔项）。
 * @param text - 段文本（非空）
 * @param state - 跨行延续的差分状态
 * @param generatedColumn - 本行上一段的 generated column（本行内延续）
 * @returns 绝对段与新的 generated column
 */
function decodeSegment(
  text: string,
  state: MappingState,
  generatedColumn: number,
): { segment: MappingSegment; generatedColumn: number } {
  const values: number[] = [];
  let index = 0;
  while (index < text.length) {
    const decoded = decodeVlq(text, index);
    values.push(decoded.value);
    index = decoded.next;
  }
  const [first = 0, sourceIndexDelta, sourceLineDelta = 0, sourceColumnDelta = 0, nameIndexDelta] =
    values;
  if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
    throw new Error(`dsh-plugin-shared: 源映射段字段数非法（${values.length}）：${text}`);
  }
  const nextGeneratedColumn = generatedColumn + first;
  if (sourceIndexDelta === undefined) {
    return {
      segment: {
        generatedColumn: nextGeneratedColumn,
        sourceIndex: null,
        sourceLine: null,
        sourceColumn: null,
        nameIndex: null,
      },
      generatedColumn: nextGeneratedColumn,
    };
  }
  state.sourceIndex += sourceIndexDelta;
  state.sourceLine += sourceLineDelta;
  state.sourceColumn += sourceColumnDelta;
  const nextNameIndex = nameIndexDelta === undefined ? null : state.nameIndex + nameIndexDelta;
  if (nextNameIndex !== null) {
    state.nameIndex = nextNameIndex;
  }
  return {
    segment: {
      generatedColumn: nextGeneratedColumn,
      sourceIndex: state.sourceIndex,
      sourceLine: state.sourceLine,
      sourceColumn: state.sourceColumn,
      nameIndex: nextNameIndex,
    },
    generatedColumn: nextGeneratedColumn,
  };
}

/**
 * 解一行。
 * @param line - 一行 `mappings`
 * @param state - 跨行延续的差分状态
 * @returns 本行的绝对段
 */
function decodeLine(line: string, state: MappingState): MappingSegment[] {
  const segments: MappingSegment[] = [];
  let generatedColumn = 0;
  for (const text of line.split(",")) {
    if (text !== "") {
      const { segment, generatedColumn: nextGeneratedColumn } = decodeSegment(
        text,
        state,
        generatedColumn,
      );
      segments.push(segment);
      generatedColumn = nextGeneratedColumn;
    }
  }
  return segments;
}

/**
 * 解整份 `mappings`：每行一组段，段里的源坐标已还原成绝对值。
 *
 * Source Map v3 的 source index / original line / original column / name index 的差分状态
 * **跨生成行延续**，只有 generated column 每行重置。整行置空而不重编码，会把后续段的
 * 基准一起抽掉 —— 这正是本模块要避免的那类错位。
 * @param mappings - `mappings` 字段
 * @returns 每行的绝对段
 */
function decodeMappings(mappings: string): MappingSegment[][] {
  const state: MappingState = { sourceIndex: 0, sourceLine: 0, sourceColumn: 0, nameIndex: 0 };
  return mappings.split(";").map((line) => decodeLine(line, state));
}

/** 编码时的差分状态（与解码对称：source/name 基准跨行延续）。 */
interface EncodeState {
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex: number;
}

/**
 * 编一段。
 * @param segment - 绝对段
 * @param state - 跨行延续的差分状态
 * @param previousGeneratedColumn - 本行上一段的 generated column
 * @returns 段文本与本段的 generated column
 */
function encodeSegment(
  segment: MappingSegment,
  state: EncodeState,
  previousGeneratedColumn: number,
): { text: string; generatedColumn: number } {
  const { generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex } = segment;
  const fields: number[] = [generatedColumn - previousGeneratedColumn];
  if (sourceIndex !== null && sourceLine !== null && sourceColumn !== null) {
    const nameDelta = nameIndex === null ? null : nameIndex - state.nameIndex;
    fields.push(
      sourceIndex - state.sourceIndex,
      sourceLine - state.sourceLine,
      sourceColumn - state.sourceColumn,
      ...(nameDelta === null ? [] : [nameDelta]),
    );
    state.sourceIndex = sourceIndex;
    state.sourceLine = sourceLine;
    state.sourceColumn = sourceColumn;
    if (nameIndex !== null) {
      state.nameIndex = nameIndex;
    }
  }
  return { text: fields.map((value) => encodeVlq(value)).join(""), generatedColumn };
}

/**
 * 编一行。
 * @param segments - 本行的绝对段
 * @param state - 跨行延续的差分状态
 * @returns 本行的 `mappings` 文本
 */
function encodeLine(segments: readonly MappingSegment[], state: EncodeState): string {
  let previousGeneratedColumn = 0;
  const encoded: string[] = [];
  for (const segment of segments) {
    const { text, generatedColumn } = encodeSegment(segment, state, previousGeneratedColumn);
    encoded.push(text);
    previousGeneratedColumn = generatedColumn;
  }
  return encoded.join(",");
}

/**
 * 把绝对段重新编成 `mappings`。
 * @param lines - 每行的绝对段
 * @returns `mappings` 字段
 */
function encodeMappings(lines: readonly MappingSegment[][]): string {
  const state: EncodeState = { sourceIndex: 0, sourceLine: 0, sourceColumn: 0, nameIndex: 0 };
  return lines.map((segments) => encodeLine(segments, state)).join(";");
}

/** 字符串数组判定。 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * `JSON.parse` 的结果 → 源映射；不合法时回 null。
 *
 * 只判“是对象”不够：`{"mappings": null}` 会在后面的 `.split(";")` 上抛 TypeError，
 * `{}` 会被当成一份没有 mappings 的“有效”映射递进覆盖率链。这里把真正依赖的字段
 * 一次判完；调用方再按流水线决定“坏 map 是失败还是降级”。
 * @param value - 解析结果
 * @returns 规整后的源映射，或 null
 */
function sourceMapOf(value: unknown): SourceMapText | null {
  if (!isRecord(value)) {
    return null;
  }
  const { version, mappings, sources, names, sourcesContent } = value;
  if (version !== 3 || typeof mappings !== "string" || !isStringArray(sources)) {
    return null;
  }
  if (names !== undefined && !isStringArray(names)) {
    return null;
  }
  if (sourcesContent !== undefined && !isStringArray(sourcesContent)) {
    return null;
  }
  return {
    version: 3,
    sources: [...sources],
    mappings,
    ...(names === undefined ? {} : { names: [...names] }),
    ...(sourcesContent === undefined ? {} : { sourcesContent: [...sourcesContent] }),
  };
}

/**
 * 读 tsc 的源映射。
 *
 * 策略按流水线分开：构建路径允许“没有 .map”（堆栈映射会差一些，但不该让模块装不上）；
 * 测试路径不允许——覆盖率靠它把被装饰的模块纳入统计，缺了或坏了必须当场失败，不能指望
 * 100% 门禁自己发现一个根本没被统计的文件。**任何路径**都不接受“存在但形状非法”的 map。
 * @param mapPath - `.map` 路径
 * @param coverageHints - 是否测试流水线
 * @param source - 源文件（错误消息用）
 * @returns 源映射；构建路径缺席时为 null
 */
function readSourceMap(
  mapPath: string,
  coverageHints: boolean,
  source: string,
): SourceMapText | null {
  let text: string;
  try {
    text = readFileSync(mapPath, "utf8");
  } catch (error) {
    if (coverageHints) {
      throw new Error(
        `dsh-plugin-shared: 测试流水线需要源映射，但 ${source} 没有产出 ${path.basename(mapPath)}。` +
          "缺了它，被装饰的模块会从覆盖率统计里消失。",
        { cause: error },
      );
    }
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`dsh-plugin-shared: 源映射不是合法 JSON（${source}）`, { cause: error });
  }
  const map = sourceMapOf(parsed);
  if (map === null) {
    throw new Error(`dsh-plugin-shared: 源映射不是合法的 Source Map v3（${source}）`);
  }
  if (map.sources.length !== 1) {
    throw new Error(
      `dsh-plugin-shared: 单文件预转换必须是单源映射（${source} 有 ${map.sources.length} 个源）`,
    );
  }
  if (map.sourcesContent !== undefined && map.sourcesContent.length !== map.sources.length) {
    throw new Error(
      `dsh-plugin-shared: 源映射的 sourcesContent 与 sources 数量不一致（${source}）`,
    );
  }
  if (map.mappings.length === 0) {
    throw new Error(`dsh-plugin-shared: 源映射的 mappings 为空（${source}）`);
  }
  return map;
}

/**
 * tsc 异常终止的错误头部短语。Windows 的 spawnSync 不回 signal（`process.kill(pid, "SIGTERM")`
 * 以退出码 1 终止），信号臂在该平台只有合成入参能到达——分支收进纯函数，两臂才进得了
 * 所有平台的覆盖率分母；POSIX 与 Windows 的真实路径另由集成用例各钉一条。
 * @param source - 被编译的源文件
 * @param run - spawnSync 结果的形状；只读 signal 与 status 两位
 * @returns 异常终止的头部短语；正常退出（signal 为 null 且 status 为 0）返回 null
 */
export function tscFailureHeadOf(
  source: string,
  run: { signal: string | null; status: number | null },
): string | null {
  if (run.signal !== null) {
    return `tsc 被信号终止（${run.signal}，${source}）`;
  }
  if (run.status !== 0) {
    return `tsc 装饰器降级失败（${source}，退出码 ${run.status}）`;
  }
  return null;
}

/**
 * 跑一次 tsc；非零退出、信号终止或 spawn 失败都带完整 stdout/stderr 抛出。
 *
 * `--noCheck` 让“退出码”重新有意义：没有那条必然的 TS2307，非零就是真问题。成功路径即使
 * tsc 写了什么也不打印，保持构建与测试日志干净。
 * @param tscEntry - tsc 入口
 * @param outDir - 产物目录
 * @param source - 临时源文件
 * @returns stdout/stderr（成功路径也收着，供“没有产物”时拼错误）
 */
function runTsc(tscEntry: string, outDir: string, source: string): TscRun {
  const args = [
    tscEntry,
    "--ignoreConfig",
    "--noResolve",
    "--noCheck",
    "--target",
    "es2024",
    "--module",
    "preserve",
    "--sourceMap",
    "--outDir",
    outDir,
    source,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  /* v8 ignore next 10 -- spawnSync 的 error 只在 Node 本身无法启动时出现；这里没有可注入的测试点 */
  if (result.error !== undefined) {
    // spawnSync 在 error 时 runtime 会把 stdout/stderr 置空，而 @types/node 仍标成 string。
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 见上：类型与 runtime 不一致
    const stdout = result.stdout ?? "";
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上
    const stderr = result.stderr ?? "";
    throw new Error(
      `dsh-plugin-shared: 无法启动 tsc（${tscEntry}）：${result.error.message}。stdout：${stdout.trim() || "（空）"}；stderr：${stderr.trim() || "（空）"}`,
      { cause: result.error },
    );
  }
  const { stdout, stderr } = result;
  const failureHead = tscFailureHeadOf(source, result);
  if (failureHead !== null) {
    throw new Error(
      `dsh-plugin-shared: ${failureHead}。stdout：${stdout.trim() || "（空）"}；stderr：${stderr.trim() || "（空）"}`,
    );
  }
  return { stdout, stderr };
}

/**
 * 读 tsc 写出的 JS；缺失或空字节都算失败，并把 tsc 的诊断拼进消息。
 * @param emitted - 产物路径
 * @param source - 源文件
 * @param tsc - tsc 调用结果
 * @returns 产物正文
 */
function readEmittedCode(emitted: string, source: string, tsc: TscRun): string {
  let js: string;
  try {
    js = readFileSync(emitted, "utf8");
  } catch (error) {
    throw new Error(
      `dsh-plugin-shared: 装饰器降级没有产出 ${path.basename(emitted)}（${source}）。` +
        `stdout：${tsc.stdout.trim() || "（空）"}；stderr：${tsc.stderr.trim() || "（空）"}`,
      { cause: error },
    );
  }
  if (js.length === 0) {
    throw new Error(`dsh-plugin-shared: 装饰器降级没有产出任何字节（${source}）`);
  }
  return js;
}

/**
 * 把一个带装饰器的 TS 文件编译成 JS。
 *
 * 编译的是 `code` 本身：先写进临时目录里同后缀的文件，再让 tsc 编它。这样判据、编译输入与
 * `sourcesContent` 永远是同一份文本；虚拟模块与前置 transform 不会造出“判 B、编 A”的分裂。
 * @param code - 源文本
 * @param file - 源文件的模块 id（通常是绝对路径；虚拟 id 也可以，用于 sources 与错误消息）
 * @param options - tsc 入口与解析器
 * @param coverageHints - 测试流水线的覆盖率提示：只从源映射里摘掉注入样板；代码与构建路径逐字节相同，
 *   `Symbol.metadata` 发布句在两条流水线里都保留
 * @returns 编译后的代码与源映射
 */
export function lowerStandardDecorators(
  code: string,
  file: string,
  options: DecoratorLoweringOptions,
  coverageHints = false,
): LoweredDecorators {
  if (code.length === 0) {
    // 空输入不可能带装饰器（形状门槛已过）；这一句只为说明 `code` 为何参与签名。
    return { code, map: null };
  }
  const extension = sourceExtensionOf(file);
  const tempRoot = mkdtempSync(path.join(tmpdir(), TMP_PREFIX));
  const sourceDir = path.join(tempRoot, "src");
  const outDir = path.join(tempRoot, "out");
  try {
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    const source = path.join(sourceDir, `source${extension}`);
    writeFileSync(source, code, "utf8");
    const tsc = runTsc(options.tscEntry, outDir, source);
    const emitted = path.join(outDir, `source${emittedExtensionOf(source)}`);
    const emittedCode = readEmittedCode(emitted, source, tsc);
    const stripped = stripTrailingSourceMapComment(emittedCode);
    const map = readSourceMap(`${emitted}.map`, coverageHints, file);
    if (map === null) {
      return { code: stripped.code, map: null };
    }
    map.sources = [file];
    map.sourcesContent = [code];
    if (!coverageHints) {
      return { code: stripped.code, map };
    }
    const plumbing = generatedPlumbingLines(emittedCode, options.parseAst, file);
    const decoded = decodeMappings(map.mappings);
    const lineCount = emittedCode.split("\n").length;
    while (decoded.length < lineCount) {
      decoded.push([]);
    }
    decoded.length = lineCount;
    for (const line of plumbing.metadata) {
      decoded[line] = [];
    }
    for (const line of plumbing.esDecorate) {
      decoded[line] = [];
    }
    if (stripped.line !== null) {
      decoded[stripped.line] = [];
    }
    map.mappings = encodeMappings(decoded);
    // 测试路径只摘掉注入样板的**映射**，不删除 tsc 写出的可执行语句：`Symbol.metadata` 的发布
    // 语义在两条流水线里完全一致。覆盖率靠“这些生成行没有源映射”把它们排除，而不是靠改代码。
    return { code: stripped.code, map };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/** 插件 id → 文件名：剥掉 `?` 之后的 query（`x.ts?import` / `x.ts?raw` 是同一份源码的
 *  不同取用方式）。两条流水线都必须先过它 —— 只让 Vite 侧剥 query 时，rolldown 侧那些带 query
 *  的 id 会因后缀判据不匹配而**静默跳过**降级。 */
function fileIdOf(id: string): string {
  return id.includes("?") ? id.slice(0, id.indexOf("?")) : id;
}

/** rolldown 插件：在它的解析器看到源码之前把标准装饰器编译掉。 */
export function rolldownDecorators(options: DecoratorLoweringOptions): {
  readonly name: string;
  readonly transform: (code: string, id: string) => LoweredDecorators | null;
} {
  return {
    name: "dsh-plugin-shared:standard-decorators",
    transform(code: string, id: string): LoweredDecorators | null {
      const file = fileIdOf(id);
      return needsDecoratorLowering(file, code, options.parseAst)
        ? lowerStandardDecorators(code, file, options)
        : null;
    },
  };
}

/** Vite 插件（测试流水线）：与上面同源，只是挂到 Vite 的钩子上（`enforce: "pre"` 保证在它前面）。
 *  第三个实参 = 覆盖率提示：**只有测试流水线要**（构建产物的字节不该带它，见 lowerStandardDecorators）。 */
export function viteDecorators(options: DecoratorLoweringOptions): {
  readonly name: string;
  readonly enforce: "pre";
  readonly transform: (code: string, id: string) => LoweredDecorators | undefined;
} {
  return {
    name: "dsh-plugin-shared:standard-decorators",
    enforce: "pre",
    transform(code: string, id: string): LoweredDecorators | undefined {
      const file = fileIdOf(id);
      // 单 return：两个分支只差"要不要编译"，而 lint 的 consistent-return 盯着返回值形状。
      return needsDecoratorLowering(file, code, options.parseAst)
        ? lowerStandardDecorators(code, file, options, true)
        : undefined;
    },
  };
}
