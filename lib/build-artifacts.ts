// lib/build-artifacts.ts —— 插件包构建脚本的通用机械代码。
//
// 为什么收进 shared：这些代码此前在各插件的 build-utils.mjs / build-*.mjs 里各带一份近似副本，
// 而副本的失效方式是「只修一侧」——原子写入、输出检查或直跑判断改在一处，其余仓仍是旧行为，
// 各仓测试又只覆盖自己那一半，没有任何检查会失败。统一之后，判断只有一处可改。
//
// 这里只放与具体产物形态无关的机械代码；host / client / types 三条构建链各自的领域判断在
// 同目录的 build-host.ts / build-client.ts / build-types.ts。不进 barrel：构建期专用，
// 运行期消费方不该为它多一次导入（与 canonicalize-region-paths 同一条收录标准）。
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import type { CommentsOptions, InputOptions } from "rolldown";
// 对象守卫的真源在 ./record.ts（本文件此前的副本仅 `&&` 操作数换序，record.ts 头注已
// 认定语义同余）。这里保留转发导出——build-host.ts 与本文件自己的 asRecord 都用它——
// 本地绑定换名（isRecordOf）以满足「导出用 export-from 形态」的 lint 契约。
import { isRecord as isRecordOf } from "./record.ts";
import { escapeRegExp } from "./value.ts";

export { escapeRegExp } from "./value.ts";

export { isRecord } from "./record.ts";

/**
 * 从 JSON.parse 的 unknown 投影为 Record（非对象 → 空对象回退），避免 any 索引。
 * @param raw - JSON.parse 之后的任意值
 * @returns 普通对象；输入不是对象时为空对象
 */
export function asRecord(raw: unknown): Record<string, unknown> {
  return isRecordOf(raw) ? raw : {};
}

/**
 * 读包根的 package.json，带上下文的失败信息。
 *
 * 惰性（调用时才读）而不是在消费方模块顶层读：顶层一次 JSON 语法错误会以未捕获的顶层
 * await 错误 + 不带文件路径的 SyntaxError 收场，读者看不出是哪个文件坏了；而测试 import 构建模块时
 * 只为拿构建函数，不该连带做一次磁盘 I/O。
 * @param root - 包根绝对路径
 * @returns 解析后的 manifest
 */
export async function readManifest(root: string): Promise<unknown> {
  const file = path.join(root, "package.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`读 ${file} 失败：${String(error)}`, { cause: error });
  }
}

/**
 * 说明符的包名段：`@scope/pkg/sub` → `@scope/pkg`，`pkg/sub` → `pkg`。
 *
 * external 的字符串项是精确匹配，所以按「包名段」判定而不是枚举子路径。
 * @param id - 说明符
 * @returns 包名段
 */
export function packageNameOf(id: string): string {
  // 按「第几个 `/`」取值而不是取 `split` 的下标：`noUncheckedIndexedAccess` 下
  // `segments[0]` 的类型是 `string | undefined`，为了过类型检查就得补一个永不求值的
  // 回退，而那个回退会让人以为空 id 有专门处理。
  const firstSlash = id.indexOf("/");
  if (!id.startsWith("@")) {
    return firstSlash === -1 ? id : id.slice(0, firstSlash);
  }
  const secondSlash = firstSlash === -1 ? -1 : id.indexOf("/", firstSlash + 1);
  return secondSlash === -1 ? id : id.slice(0, secondSlash);
}

/**
 * 包名 → 锚定的外置正则（`^pkg(/|$)`）。
 *
 * 为什么不再用函数形态：rolldown 官方 `external` 文档的 warning 段写明，函数形态每个模块都要
 * 回调一次 JS，性能开销显著，建议用非函数值。而字符串项是**全等**匹配（Rust 侧 `String` 走
 * `memmem::find`，见 `is_external.rs`），写 `"pkg"` 不会命中 `pkg/sub`，于是子路径要么漏外置、
 * 要么得枚举——正则数组是两者之间唯一同时满足「非函数」与「子路径也命中」的形状。
 * @param name - 包名段（`@scope/pkg` 或 `pkg`）
 * @returns 锚定到包名边界的正则
 */
export function packagePatternOf(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name)}(?:/|$)`, "u");
}

/**
 * 说明符 → 锚定的外置正则：裸包名按包名边界泛化，带子路径的登记项**精确匹配**。
 *
 * 为什么子路径不能泛化：宿主模块表按说明符全等查键，泛化后 `^@scope/pkg(?:/|$)` 会把
 * `@scope/pkg/lib/record` 这类**没有登记**的子路径也外置，产物里于是留下一条加载期必然
 * miss 的 `require(...)`（三个仓实测各多出一条）。而精确匹配的语义与旧实现的
 * 「`externalNames.has(packageNameOf(id))` + 子路径不命中」在裸包名一侧完全一致，
 * 差异只在「登记了子路径时要不要连带外置它的兄弟子路径」——旧实现不会，这里也不该。
 * @param specifier - 登记的外置说明符（裸包名或子路径）
 * @returns 锚定正则
 */
export function externalPatternOf(specifier: string): RegExp {
  if (packageNameOf(specifier) === specifier) {
    return packagePatternOf(specifier);
  }
  return new RegExp(`^${escapeRegExp(specifier)}$`, "u");
}

/**
 * rolldown 输出项的最小投影：单文件产物只关心这几项。
 *
 * `moduleIds` 进投影是因为 host 链要核对 entry chunk 里确实只有入口模块（见 build-host 的
 * 模块清单判据）；其余字段（`imports` / `exports` / `dynamicImports` …）仍不进——
 * 多一层声明就多一处与 rolldown 版本耦合的地方，而调用方拿到的仍是原始输出项，不缺字段。
 */
export interface OutputItem {
  readonly type: string;
  readonly fileName: string;
  readonly code?: string | undefined;
  readonly isEntry?: boolean | undefined;
  readonly moduleIds?: readonly string[] | undefined;
}

/**
 * 只认「空白 + 注释 + 指令序言字符串」的正文形态。
 *
 * 逐段剥而不是「先遮蔽再判」：遮蔽器不识别正则字面量，`const re = /"/;` 里的引号会被
 * 当成字符串起点，把它后面的正文一起遮掉——一份合法产物会被误判为空。这里反过来只
 * 列举文件头允许出现的空形态，遇到任何别的 token 就返回 false（保持放行面）。
 *
 * 指令序言可以没有分号（ASI），所以字符串段的 `;` 是可选的；注释按 JS 的两种行形态
 * 处理，块注释到第一个闭合标记为止。
 */
/** JS 的四类行终止符：LF / CR / LS（U+2028）/ PS（U+2029）。 */
function isLineTerminator(ch: string): boolean {
  return ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
}

/**
 * 行注释正文的终点（不含行终止符本身）。`maskNonCode` 与 `isBlankModuleBody` 共用这一份：
 * 行注释只可能止于四类 JS 行终止符，新增语义时只改这里。
 * @param code - 完整正文
 * @param from - 行注释正文起点（`//` 之后）
 * @returns 行终止符的下标；整行到文件尾时为长度
 */
function lineCommentEndAt(code: string, from: number): number {
  let index = from;
  while (index < code.length && !isLineTerminator(code.charAt(index))) {
    index += 1;
  }
  return index;
}

/**
 * 从字符串/模板字面量开头读到闭合引号之后。
 *
 * 不把 `${` 的模板算作空形态：插值里可能有副作用，那已经是可执行代码。未闭合、
 * 跨行或带插值的模板一律返回 undefined，由调用方按「有正文」放行。
 * @param code - 以引号开头的正文
 * @returns 闭合引号之后的下标；不是字符串或不是可判定的空形态时为 undefined
 */
function stringEndAt(code: string): number {
  const quote = code.charAt(0);
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return -1;
  }
  let index = 1;
  while (index < code.length) {
    const ch = code.charAt(index);
    if (ch === "\\") {
      index += 2;
    } else if (ch === quote) {
      return index + 1;
    } else if (quote === "`" && ch === "$" && code.charAt(index + 1) === "{") {
      return -1;
    } else if (isLineTerminator(ch)) {
      return -1;
    } else {
      index += 1;
    }
  }
  return -1;
}

/**
 * 这份正文是否只剩注释、指令序言或空语句。
 *
 * 只从文件头依次剥「空白 / 注释 / 字符串指令 / 分号」；遇到任何别的字符就判为有正文。
 * 不用遮蔽器：它不识别正则字面量，`/"/` 里的引号会被当成字符串起点，把后面的真实
 * 代码一并遮掉——一份合法产物会被误判为空。这里只认文件头允许的空形态，正则字面量
 * 以 `/` 开头，第一眼就不在空形态里，不会触发误判。
 * @param code - 产物正文
 * @returns 没有任何可执行语句时为真
 */
function isBlankModuleBody(code: string): boolean {
  let rest = code;
  let blank = true;
  while (blank && rest !== "") {
    rest = rest.trimStart();
    if (rest === "") {
      blank = true;
      break;
    }
    if (rest.startsWith("//")) {
      rest = rest.slice(lineCommentEndAt(rest, 0));
    } else if (rest.startsWith("/*")) {
      const close = rest.indexOf("*/");
      rest = close === -1 ? "" : rest.slice(close + 2);
    } else if (rest.startsWith(";")) {
      rest = rest.slice(1);
    } else {
      const end = stringEndAt(rest);
      blank = end > 0;
      if (end > 0) {
        rest = rest.slice(end);
      }
    }
  }
  return blank;
}

/**
 * 单文件产物只接受一个带正文的 entry chunk。
 *
 * 正文还必须非空白：`typeof code === "string"` 会放行空串与纯空白，而那两种状态写入磁盘后是
 * 一份语法上能解析、跑起来什么都不做的产物——构建报成功，宿主那条路不渲染，也不报错。
 * @param item - 输出项
 * @returns 是否为带正文的 entry chunk
 */
function isEntryChunk(
  item: OutputItem | undefined,
): item is OutputItem & { code: string; isEntry: true } {
  return (
    item?.type === "chunk" &&
    item.isEntry === true &&
    typeof item.code === "string" &&
    item.code.trim() !== ""
  );
}

/**
 * 单文件产物只允许一个 entry chunk：多余 chunk / asset 不写入磁盘，产物要到运行时才因缺模块而报错。
 * 这是「静默不渲染」同一类难查故障，所以在构建期就失败。
 *
 * 形状之外还要求正文里有**可执行语句**：只剩注释、只有 `"use strict";`、或只有若干空语句的
 * 产物同样是一份「加载成功、什么都不做」的模块，宿主那条路不渲染、也不报错。导出面与依赖
 * 供应归各仓 host / client 自己的测试——那是产物语义，塞进共享层只会得到一条与 rolldown
 * 版本耦合的近似判断；这里只关掉「文本上完全为空」这一种确定的失效。
 * @param output - rolldown 的 generate 输出清单
 * @param source - 入口源码名（供错误信息指出出处）
 * @returns 唯一的那个 entry chunk
 */
export function singleEntryChunk(
  output: readonly OutputItem[],
  source: string,
): OutputItem & { code: string } {
  if (output.length !== 1) {
    const names = output.map((item) => `${item.type}:${item.fileName}`).join(", ");
    throw new Error(
      `rolldown 为 ${source} 产出了 ${output.length} 项输出（期望恰好一个 entry chunk）：${names}`,
    );
  }
  const chunk = output.at(0);
  if (!isEntryChunk(chunk)) {
    throw new Error(`rolldown 为 ${source} 产出的不是单个带正文的 entry chunk`);
  }
  if (isBlankModuleBody(chunk.code)) {
    throw new Error(
      `rolldown 为 ${source} 产出的 entry chunk 里只有注释、指令序言或空语句，没有可执行语句：` +
        "这份产物加载成功但什么都不做，宿主不会渲染也不会报错。检查入口是否被 tree-shaking 整段删除。",
    );
  }
  return chunk;
}

/** Windows 上目标文件被占用时的错误码：EPERM 来自只读/映射文件，EBUSY 来自被打开的文件，
 *  EACCES 来自权限或占用方暂时拒绝写入。 */
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
/** 重试的等待序列（毫秒）。总等待控制在半秒内：占用者通常是杀毒/索引服务，退避即可。 */
const RENAME_RETRY_DELAYS_MS = [50, 100, 200];

/**
 * rename 的 Windows 退避重试。
 *
 * POSIX 上 rename 换目录项是原子的，失败即真失败——`EACCES` 在那一边也不会自己消失，
 * 重试只是把一条确定的失败拖后半秒。Windows 上目标文件被其它进程持有（Electron /
 * dev server 正 require 产物、杀毒或索引服务短暂占用）时会给 EPERM/EBUSY/EACCES，
 * 而占用通常在几十毫秒内释放；不重试的话这条失败是**间歇性**的：同一份安装里连着
 * 构建两次，一次失败一次成功。其余错误码照旧立即抛出。
 * @param from - 草稿文件
 * @param to - 目标文件
 * @param attempt - 已重试次数（内部状态，不进公开签名，避免外部参数绕过退避预算）
 */
async function renameAttempt(from: string, to: string, attempt: number): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    // 只按「有没有 code 字段」判形态：Node 的 fs 错误都带 code，其余异常一律原样上抛。
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (typeof code !== "string" || process.platform !== "win32" || !RENAME_RETRY_CODES.has(code)) {
      throw error;
    }
    const delay = RENAME_RETRY_DELAYS_MS.at(attempt);
    if (delay === undefined) {
      throw error;
    }
    // 退避后重试同一对路径。写成递归而不是 for 里 await：这里每一步都**必须**等上一步结束，
    // 没有可并行的空间，而 for + await 会让「顺序」看起来像可以改成 Promise.all 的并行。
    await sleep(delay);
    await renameAttempt(from, to, attempt + 1);
  }
}

/**
 * rename，Windows 上按占用码退避重试（理由见 {@link renameAttempt}）。
 * @param from - 草稿文件
 * @param to - 目标文件
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  await renameAttempt(from, to, 0);
}

/**
 * 原子写入：目标目录下 `.tmp/` 草稿 + rename；失败时清掉草稿再抛。
 *
 * 草稿落在**目标文件所在目录**下的 `.tmp/`，不是 `os.tmpdir()`，也不是产物旁边的裸名：
 *   - 不用 `os.tmpdir()`：rename 只在同一文件系统内原子，跨设备会以 EXDEV 失败，而系统临时
 *     目录常被挂到另一个分区/卷；
 *   - 跟随目标目录而不是写死包根：本函数定义在公共库里，产物写到哪儿由调用方决定；
 *   - 不用「产物名 + 后缀」直接落在产物旁边：那个名字通常不在 `.gitignore` 里，构建被中断
 *     时半份产物会以未跟踪文件出现在 `git status`，被误当成源码改动提交。`.tmp/` 是各包
 *     统一忽略的目录，不需要为构建残留单独扩忽略规则。
 *
 * 失败信息带上两个路径并保留 cause：只有 `ENOENT … open '…/<uuid>.tmp'` 把注意力引到草稿名上，
 * 读者还得自己从中找出真正的产物路径。目录准备也在这条包装之内——`.tmp` 被占成普通文件时，
 * 裸 `EEXIST` 同样指不出是哪个产物的写入失败了。
 *
 * 草稿名只用 UUID、不拼产物名：产物名很长时「产物名 + 后缀」会触发 `ENAMETOOLONG`，
 * 而草稿名对读者没有意义（错误信息里两个路径都写了）。
 * @param target - 目标文件绝对路径
 * @param text - 产物正文
 */
export async function writeArtifact(target: string, text: string): Promise<void> {
  const scratchDir = path.join(path.dirname(target), ".tmp");
  const scratch = path.join(scratchDir, `${randomUUID()}.tmp`);
  try {
    await mkdir(scratchDir, { recursive: true });
    await writeFile(scratch, text, "utf8");
    await renameWithRetry(scratch, target);
  } catch (error) {
    // 清草稿本身可能失败（Windows 上 EBUSY/EPERM，`force` 只忽略 ENOENT），那一下抛出去会把
    // 真正的写入错因盖掉。随机名保证残留草稿不会与下一次构建撞名。
    try {
      await rm(scratch, { force: true });
    } catch {
      // 见上：清理失败不值得盖住错因。
    }
    throw new Error(`写产物失败：${target}（草稿 ${scratch}）：${String(error)}`, { cause: error });
  }
}

/**
 * 把注释与字符串/模板字面量的**内容**替换成空格，逐字符等长、行终止符原样保留。
 *
 * 用途只有一个：给**声明文本**（tsc 生成的 `.d.ts` / `.d.mts` / `.d.cts`）提供一份与原文
 * 逐字符对齐的「只看程序正文」文本，让调用方拿同一套下标回原文取值——声明里的
 * `from "./x.ts"` 可能出现在注释或字面量类型的示例里，改写与残余校验都必须跳过那些位置。
 *
 * 契约边界（这里也是唯一的记法处）：
 *  - **只承诺声明文本**。声明里没有正则字面量；正则里的引号会被当成字符串起点，从而把
 *    其后的正文一起遮掉。因此**不要**拿本函数的阴性结果判断「这份源码没有某段语法」——
 *    那个判断必须交给真正的解析器（装饰器门槛已改用 AST，不再经过本函数）。
 *  - 模板字面量按语法递归 `${}`：表达式里的字符串、注释与嵌套模板各自成段，外层模板在
 *    正确的反引号处结束，不会因为内层的裸反引号提前收尾。
 *  - 转义对整体遮蔽；反斜杠后的行延续保留原来的行终止符（`\n`、`\r` 与 CRLF 都算）。
 *    末尾孤立的反斜杠只遮蔽它自己，长度不变。
 *  - 未闭合的字符串 / 模板 / 块注释一律吃到文件尾；行注释止于任一 JS 行终止符，
 *    不再只认 `\n`。
 * @param code - 声明文本
 * @returns 与入参逐字符等长的遮蔽文本
 */
export function maskNonCode(code: string): string {
  const out: string[] = [];

  /** 一个输入字符的遮蔽字符：行终止符保留，其余变空格。 */
  const blank = (ch: string): void => {
    out.push(isLineTerminator(ch) ? ch : " ");
  };

  /** 把 [from, to) 逐字符遮蔽（行终止符由 blank 保留）。 */
  const blankRange = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      blank(code.charAt(index));
    }
  };

  /** 块注释的终点：闭合标记之后，未闭合时为文件尾。 */
  const blockCommentEnd = (from: number): number => {
    const close = code.indexOf("*/", from);
    return close === -1 ? code.length : close + 2;
  };

  /** 字符串或模板里的转义对（反斜杠 + 下一个字符，或末尾孤立的反斜杠）。 */
  const scanEscape = (at: number): number => {
    blank("\\");
    const next = code.charAt(at + 1);
    if (next === "") {
      return at + 1;
    }
    // 行延续：换行本身是位置信息，保留原字符（CRLF 的 `\n` 留给外层逐字符处理）。
    out.push(isLineTerminator(next) ? next : " ");
    return at + 2;
  };

  /** 单/双引号字符串；未闭合时吃到文件尾。 */
  const scanString = (at: number): number => {
    const quote = code.charAt(at);
    out.push(quote);
    let index = at + 1;
    while (index < code.length) {
      const ch = code.charAt(index);
      if (ch === "\\") {
        index = scanEscape(index);
      } else if (ch === quote) {
        out.push(ch);
        return index + 1;
      } else {
        blank(ch);
        index += 1;
      }
    }
    return index;
  };

  /** 模板字面量：`${` 之后按代码扫到配对的 `}`，再回到模板正文。 */
  const scanTemplate = (at: number): number => {
    out.push("`");
    let index = at + 1;
    while (index < code.length) {
      const ch = code.charAt(index);
      if (ch === "\\") {
        index = scanEscape(index);
      } else if (ch === "`") {
        out.push(ch);
        return index + 1;
      } else if (ch === "$" && code.charAt(index + 1) === "{") {
        out.push("$", "{");
        // oxlint-disable-next-line eslint/no-use-before-define -- scanTemplate 与 scanCode 互递归：模板表达式要按代码再扫一遍，这里只能前向引用（函数声明会提升，运行期已初始化）。
        index = scanCode(index + 2, true);
        if (index < code.length) {
          out.push("}");
          index += 1;
        }
      } else {
        blank(ch);
        index += 1;
      }
    }
    return index;
  };

  /** `scanLeaf` 的「不是叶子段」哨兵：返回值保持单一数字类型。 */
  const NO_LEAF = -1;

  /** 三种「非程序正文」段（字符串、模板、注释）的入口；都不是时返回 {@link NO_LEAF}。 */
  function scanLeaf(index: number): number {
    const ch = code.charAt(index);
    if (ch === '"' || ch === "'") {
      return scanString(index);
    }
    if (ch === "`") {
      return scanTemplate(index);
    }
    if (code.startsWith("//", index)) {
      const end = lineCommentEndAt(code, index + 2);
      blankRange(index, end);
      return end;
    }
    if (code.startsWith("/*", index)) {
      const end = blockCommentEnd(index + 2);
      blankRange(index, end);
      return end;
    }
    return NO_LEAF;
  }

  /**
   * 扫程序正文；`stopAtBrace` 时在第一个未配对的 `}` 处停下（模板表达式的边界）。
   * @param from - 起始下标
   * @param stopAtBrace - 是否把未配对的 `}` 当终止符
   * @returns 停下的下标（终止符本身未消费）
   */
  function scanCode(from: number, stopAtBrace: boolean): number {
    let index = from;
    let depth = 0;
    while (index < code.length) {
      const leaf = scanLeaf(index);
      if (leaf === NO_LEAF) {
        const ch = code.charAt(index);
        if (stopAtBrace && ch === "}") {
          if (depth === 0) {
            return index;
          }
          depth -= 1;
        } else if (stopAtBrace && ch === "{") {
          depth += 1;
        }
        out.push(ch);
        index += 1;
      } else {
        index = leaf;
      }
    }
    return index;
  }

  scanCode(0, false);
  return out.join("");
}

/** 异常路径上释放 rolldown bundle 的最小接口。 */
export interface CloseableBundle {
  readonly close: () => Promise<void>;
}

/**
 * generate 交给调用方的最小输出结构（属性式签名，真实 bundle 结构满足）。
 *
 * 只列本包真正会下发的键，每个都带官方出处：`comments` 还接受对象形态（`legal` /
 * `annotation` / `jsdoc` 三档，见 rolldown 的 `CommentsOptions`），`codeSplitting` 与
 * `dynamicImportInCjs` 来自 `OutputOptions`。这几项默认值都不是「我们想要的」形态：
 * `codeSplitting` 缺省会把动态 import 拆成额外 chunk、`dynamicImportInCjs` 缺省会把外部
 * 动态 import 留成 `import()`，而宿主的外壳只认 `require`。
 */
export interface RolldownBundle extends CloseableBundle {
  readonly generate: (options: {
    format: "esm" | "cjs";
    minify?: boolean;
    comments?: boolean | CommentsOptions;
    codeSplitting?: boolean;
    dynamicImportInCjs?: boolean;
  }) => Promise<{ output: readonly OutputItem[] }>;
}

/**
 * 调用方注入的 rolldown 构造器。
 *
 * 注入而不是由本包声明依赖：rolldown 是各包构建期自己的 devDependency，本包作为库
 * 不该为构建工具声明运行期依赖。参数类型借 rolldown 自己的 InputOptions（仅类型
 * 导入，产物里没有它）。
 */
export type RolldownFactory = (options: InputOptions) => Promise<RolldownBundle>;

/**
 * 异常路径上释放 rolldown bundle：close 失败只记日志，不覆盖调用方正在抛的原始错因。
 *
 * bundle 持有原生资源，generate 或输出守卫抛错时同样要释放；但那时唯一有价值的日志是
 * 「构建为什么失败」，让一条与错因无关的资源释放日志盖过它，排障就从「读一行」变成「猜」。
 * 成功路径不要用本函数：那里 close 失败仍应判定失败，资源没释放是构建器的问题。
 * @param bundle - 待释放的 bundle
 */
export async function closeQuietly(bundle: CloseableBundle): Promise<void> {
  try {
    await bundle.close();
  } catch (error) {
    console.error("释放 rolldown bundle 失败（不影响上面那条构建错因）:", error);
  }
}

/**
 * 直跑守卫：本脚本是否被当作入口直接执行（而不是被测试 import）。
 *
 * argv[1] 可能缺席，也可能是**异名软链**（`/tmp/build-plugin.mjs` 指向 `/repo/build-host.mjs`），
 * 或需要折成 realpath 的路径（`/tmp` → `/private/tmp`）。这里一律先折 realpath 再比，
 * 不按基名预筛：基名不同不代表不是本文件，按基名提前返回 false 会让直跑分支被静默跳过。
 *
 * 两种失败必须分开：argv[1] 与 moduleFile 都折得出 realpath 且互不相同（被 import、或被
 * 别的脚本调用）→ 安静返回 false；任一个解不出 realpath（软链断了、父目录 EACCES、
 * argv[1] 已被删除）→ 直接抛。后者若也返回 false，脚本会既不构建也不报错、以 0 退出，
 * 发布链路认为构建成功而磁盘产物仍是旧的——软链异名的情形也落在这里，不能靠基名猜测。
 * @param moduleFile - 调用方的 `import.meta.filename`
 * @returns 是否直接运行
 */
export function invokedDirectly(moduleFile: string): boolean {
  const entry = process.argv.at(1);
  if (entry === undefined || entry.length === 0) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(moduleFile);
  } catch (error) {
    throw new Error(
      `无法解析入口或本脚本的路径（argv[1]=${entry}，本脚本=${moduleFile}）：` +
        "无法证明这次执行不是本脚本，构建未发生，不要当成成功。",
      { cause: error },
    );
  }
}
