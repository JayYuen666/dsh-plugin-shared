// lib/path-scope.ts —— 「某个绝对路径是否在根之下」的唯一判据。
//
// 为什么值得单点定义：danger-guard 的三个模块与 ocr-review 的 scan-scope 各写了一遍
// 同一段 `path.relative` 判据，四份逐字相同。这条判据的失效方向是 **fail-open**：
// 「沙箱盖不住」判成真，灾难删除就会让路给同样管不了它的沙箱；四份里只要有一份把
// `..` 的前缀判断写宽或写窄，就会同时出现误判和漏判。
//
// 判据吃注入的 `PathScopeApi`，不读宿主平台：测试可以在 macOS 上用 `path.win32` 验证
// Windows 语义，而不必伪装整个运行环境。调用方必须保证 root 与 candidate 都是绝对路径
//（两条既有实现都已在入口校验过；本模块不重复做绝对性校验）。
//
// ⚠ 本模块只回答**词法包含**：不触盘、不解析符号链接与 Windows junction。它不能单独
// 证明「沙箱真的盖住了这个目标」——那一层判断属于调用方，危险的让路决定必须另有执行侧
// 的拦截面兜底（见 dsh-danger-guard 的 `sandboxDropsOf`）。同理，`true` / `false` 哪一侧
// 意味着放行也由调用方决定：判成「根外」在删除防护里是放行方向，在扫描范围里不是。
//
// ⚠ 路径同一性**不要用字符串相等**表达：`/w` 与 `/w/`、Windows 上仅大小写不同的两个串
// 是同一个路径。需要「是否同一个目录」时用 `isPathInside(a, b) && isPathInside(b, a)`，
// 不要写 `a !== b` —— 那正是本模块 `isAncestorDirOf` 曾经踩过的坑。

import nodePath from "node:path";

/** 路径判据只用到这三位；`node:path` 与 `path.win32/posix` 都结构满足。 */
export interface PathScopeApi {
  /** 平台自己的 `relative`；分隔符与 `..` 归一都由它负责。 */
  readonly relative: (from: string, to: string) => string;
  /** 平台分隔符（POSIX `/`、Windows `\\`）。 */
  readonly sep: string;
  /** 平台自己的绝对性判断。 */
  readonly isAbsolute: (value: string) => boolean;
}

/**
 * `rel` 是否为**非空的后代**相对路径：不含自身（空串）、不含上跳（`..` / `../x`），
 * 也不含跨根时 `relative` 交回的绝对形。
 *
 * 这是「后代」这一条不变式的单点实现：{@link isPathInside} 的后代出口与
 * {@link isAncestorDirOf} 的严格祖先判据都只经它，两个函数因此不会在「空 rel」这种
 * 边界上各说一套 —— `/w` 与 `/w/` 的 `relative` 是空串，曾经让「目标自身不算」失效。
 * @param rel - `relative()` 的返回值
 * @param pathApi - 平台路径实现（只需 `sep` 与 `isAbsolute`）
 * @returns 非空且确实落在根之下时为 true
 */
function isDescendantRelative(rel: string, pathApi: PathScopeApi): boolean {
  return (
    rel !== "" && rel !== ".." && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel)
  );
}

/**
 * `candidate` 是否就是 `root` 或落在它之下。
 *
 * 判「是否上跳出根」必须比**路径组件边界**，不能只看 `rel.startsWith("..")`：
 * `relative()` 对根内名为 `..cache` 的目录返回 `..cache`，那个前缀判断会把它误判成
 * 「跑到根外面」——在删除防护里那是放行方向。空串表示同一路径；`..` 与 `..${sep}` 开头
 * 表示上跳；`isAbsolute(rel)` 覆盖 Windows 上跨盘符时 `relative` 交回绝对路径的形态。
 * @param root - 绝对目录
 * @param candidate - 待判的绝对路径
 * @param pathApi - 平台路径实现
 * @returns 自身与所有后代为 true
 */
export function isPathInside(root: string, candidate: string, pathApi: PathScopeApi): boolean {
  const rel = pathApi.relative(root, candidate);
  return rel === "" || isDescendantRelative(rel, pathApi);
}

/**
 * `candidate` 是否为 `target` 的**祖先目录**（目标自身不算）。
 *
 * 「引用取证的作用域判据」与「项目根的回落取值」共用这条不变式：判定侧只认
 * 「检索起点是目标的祖先」，两处一旦不同源，就会出现「门禁教模型去搜的位置，门禁自己又不认」。
 *
 * 自身排除必须走 `relative` 的**空串**，不能走 `candidate !== target`：`/w` 与 `/w/`、
 * Windows 上仅大小写不同的两个串是同一个路径，字符串不等会把它们判成严格祖先。
 * @param candidate - 候选祖先
 * @param target - 目标路径
 * @param pathApi - 平台路径实现
 * @returns 候选是目标的严格祖先时为 true
 */
export function isAncestorDirOf(candidate: string, target: string, pathApi: PathScopeApi): boolean {
  return isDescendantRelative(pathApi.relative(candidate, target), pathApi);
}

/** 绝对路径归一与根校验的两种方言。 */
export type AbsolutePathPlatform = "posix" | "win32";

/** 归一化只需要两条拒绝文案（校验层再补类型/必填/NUL/根目录）。 */
export interface AbsolutePathMessages {
  /** 输入不是该方言下的完整绝对路径。 */
  readonly mustBeAbsolute: (input: string) => string;
  /** 路径里的 `..` 越过了文件系统根。 */
  readonly escapesRoot: (input: string) => string;
}

/** 根路径校验的全部拒绝文案；由调用方按自己的语言表填好。 */
export interface AbsoluteRootMessages extends AbsolutePathMessages {
  /** 收到非字符串（`received` 是 `null` 或 `typeof`）。 */
  readonly typeError: (received: string) => string;
  /** 空串或全空白。 */
  readonly required: string;
  /** 含 NUL 字节。 */
  readonly nul: string;
  /** 归一后落在文件系统根。 */
  readonly filesystemRoot: (input: string) => string;
}

/** Win32 扩展长度前缀 `\\?\`（统一分隔符后的形）。 */
const WIN32_EXTENDED = "\\\\?\\";
/** Win32 设备前缀 `\\.\`（同上）。 */
const WIN32_DEVICE = "\\\\.\\";
/** 扩展长度形下的 UNC 前缀 `\\?\UNC\`；`UNC` 标记按 Windows 规则不区分大小写。 */
const WIN32_EXTENDED_UNC = "\\\\?\\UNC\\";
/** 小写形：比较用（`\\?\unc\` 与 `\\?\UNC\` 同义）。 */
const WIN32_EXTENDED_UNC_LOWER = WIN32_EXTENDED_UNC.toLowerCase();

/**
 * 去掉 Windows 扩展长度/设备前缀：`\\?\C:\x` → `C:\x`、
 * `\\?\UNC\srv\share\x` → `\\srv\share\x`。
 *
 * **先统一分隔符，再剥前缀**：反过来的话 `//?/C:/repo` 这种拼写剥不到前缀，却会在随后
 * 的 `replaceAll` 里变成 `\\?\C:\repo` 混进根解析 —— 同一个目录于是留下两种规范形
 *（`\\?\C:\repo` 与 `C:\repo`），下游按字符串比较的授权键、扫描根就会各占一格。
 */
function stripWin32Extended(input: string): string {
  const unified = input.replaceAll("/", "\\");
  if (unified.slice(0, WIN32_EXTENDED_UNC.length).toLowerCase() === WIN32_EXTENDED_UNC_LOWER) {
    return `\\\\${unified.slice(WIN32_EXTENDED_UNC.length)}`;
  }
  if (unified.startsWith(WIN32_EXTENDED) || unified.startsWith(WIN32_DEVICE)) {
    return unified.slice(WIN32_EXTENDED.length);
  }
  return unified;
}

/** 盘符根 `C:\`（`C:` 是盘符相对，不算）。 */
const WIN32_DRIVE_ROOT = /^[A-Za-z]:\\$/u;

/** 普通 UNC 共享根 `\\server\share\`（尾分隔符可省）。
 *  显式排除命名空间形态：服务器名不得含 `?`（`\\??\`、`\\GLOBAL??\`），不得以 `.`
 *  开头（`\\.\` 已在剥前缀那一步折算），共享名不得含 `:`（`\\srv\share:stream` 是流，
 *  不是目录）。服务器名**允许** `:`：IPv6 字面量形如 `\\[::1]\share`，收紧它会误伤
 *  合法路径。`parse().root` 能把一个串拆出「根」，不等于那个根是受支持的普通路径 ——
 *  盘符根与本形之外一律不算完整限定路径。 */
const WIN32_UNC_ROOT = /^\\\\[^\\/?.][^\\/?]*\\[^\\/:?]+\\?$/u;

/** 盘符绝对路径（`C:\`）或普通 UNC（`\\server\share\`）的根；不是完整限定路径时 undefined。 */
function win32RootOf(input: string): string | undefined {
  const parsed = nodePath.win32.parse(input).root;
  return WIN32_DRIVE_ROOT.test(parsed) || WIN32_UNC_ROOT.test(parsed) ? parsed : undefined;
}

function normalizeWin32Path(input: string, messages: AbsolutePathMessages): string {
  const canonical = stripWin32Extended(input);
  const root = win32RootOf(canonical);
  if (root === undefined) {
    throw new Error(messages.mustBeAbsolute(input));
  }
  const parts: string[] = [];
  for (const segment of canonical.slice(root.length).split("\\")) {
    if (segment === "..") {
      if (parts.length === 0) {
        throw new Error(messages.escapesRoot(input));
      }
      parts.pop();
    } else if (segment !== "" && segment !== ".") {
      parts.push(segment);
    }
  }
  return `${root}${parts.join("\\")}`;
}

function normalizePosixPath(input: string, messages: AbsolutePathMessages): string {
  const parts: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "..") {
      if (parts.length === 0) {
        throw new Error(messages.escapesRoot(input));
      }
      parts.pop();
    } else if (segment !== "" && segment !== ".") {
      parts.push(segment);
    }
  }
  return `/${parts.join("/")}`;
}

/**
 * 绝对路径的词法归一：去空段与 `.`、解析 `..`，不触盘。
 *
 * `..` 越过文件系统根即拒绝，而不是静默钳到根：`/../../etc` 归一成 `/etc` 看似合法，
 * 实为借相对段逃逸调用方意图中的目录。两种方言都拒绝，win32 另外统一分隔符并保留
 * 盘符/UNC 根。
 *
 * POSIX 侧不校验 `/` 开头（zvec 的归一本来就把段序列按根下处理）；绝对性由
 * {@link assertAbsoluteRoot} 在入口负责，那里才知道「这是 root」还是「已是绝对目标」。
 * 所以本函数是**归一器，不是校验器**：直接调用它的地方（先拼后归一的用法）必须自己
 * 保证拼出来的串是可信的，不能指望它替入口挡掉相对的根。
 * @param input - 待归一（已 trim）的路径
 * @param platform - 路径方言
 * @param messages - 两条拒绝文案
 * @returns 归一后的绝对路径（根自身除外，无尾随分隔符）
 */
export function normalizeAbsolutePath(
  input: string,
  platform: AbsolutePathPlatform,
  messages: AbsolutePathMessages,
): string {
  return platform === "win32"
    ? normalizeWin32Path(input, messages)
    : normalizePosixPath(input, messages);
}

/**
 * 根路径校验：非空、无 NUL、该方言下的完整绝对路径、归一后不落在文件系统根。
 *
 * 「落在根」必须拒绝而不是放行：下游的仓内判据是 `relative(root, file)` 不以 `..` 开头，
 * 根为 `/` 时它对 `/etc/passwd` 给出 `etc/passwd`、条件恒成立，仓外文件会被当成仓内文件。
 *
 * `trim()` 是**输入层约定**：表单与模型给的根先去掉首尾空白再归一再校验，因此返回的是
 * trim 后的路径。它不保留「已有 POSIX 文件名里的尾部空格」——需要原样那一形时直接用
 * {@link normalizeAbsolutePath}，不要经这里。
 * @param root - 用户/模型给的根
 * @param platform - 路径方言
 * @param messages - 拒绝文案
 * @returns 归一后的绝对路径
 */
export function assertAbsoluteRoot(
  root: unknown,
  platform: AbsolutePathPlatform,
  messages: AbsoluteRootMessages,
): string {
  if (typeof root !== "string") {
    throw new TypeError(messages.typeError(root === null ? "null" : typeof root));
  }
  const trimmed = root.trim();
  if (trimmed.length === 0) {
    throw new Error(messages.required);
  }
  if (trimmed.includes("\u0000")) {
    throw new Error(messages.nul);
  }
  if (platform === "posix" && !trimmed.startsWith("/")) {
    throw new Error(messages.mustBeAbsolute(trimmed));
  }
  const normalized = normalizeAbsolutePath(trimmed, platform, messages);
  const filesystemRoot = platform === "win32" ? nodePath.win32.parse(normalized).root : "/";
  if (normalized === filesystemRoot) {
    throw new Error(messages.filesystemRoot(trimmed));
  }
  return normalized;
}
