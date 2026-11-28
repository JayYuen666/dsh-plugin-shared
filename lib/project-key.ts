// lib/project-key.ts —— cwd → 项目键的**单一来源**。
//
// 为什么存在：同一个"这次教训属于哪个项目"的判定有过两份逐字节重复的实现。键是持久化数据与
// 跨系统对照用的键名，双份实现意味着改一处漏一处——统一到这里，两侧各留一个薄别名。
//
// 跨系统约定（不可动）：对端产出的是 `尾目录名-<sha256(norm) 前 8 位 hex>`。本模块**不改**
// 哈希算法、8 位切片与尾段空白清洗（动一位就等于让既有的教训/记忆数据在新键下找不到）；只在
// 归一阶段补三处真实缺陷：
//   1. path.resolve —— 相对路径与 `./`、`../` 冗余段不再各成一个键；
//   2. realpath —— 软链接（macOS `/tmp` ↔ `/private/tmp`）指向同一目录时归一到同一个键；
//   3. Windows 命名空间 —— `\\?\C:\repo`、`\\.\C:\repo`、`\\?\UNC\server\share\repo`
//      先按命名空间分类再判根；扩展盘符根、UNC 共享根与卷 GUID 根不再被当成普通目录。
//      非根路径的哈希输入保持原拼写（不顺手折叠前缀），键格式迁移需要独立证据。
// `..` 的语义是**词法**：先 resolve 再 realpath，`/a/link/..` 归一到 `/a`，不会按 link
// 目标走到 `/b`。需要文件系统语义的调用方应先把 cwd 物理解析后再传入；本函数不替它选。
// 不变式：POSIX 上输入已是"绝对且规范"的路径时，resolve 与 realpath 都是恒等变换，产出的键与
// 旧实现逐字节相同（test/project-key.test.ts 用字面量断言固定），故 POSIX 存量键不迁移。
// Windows 的分隔符另说：`\` 与 `/` 在 Win32 API 上同义，所以那里两种字形必须先统一成一种，
// 同一目录的两种写法才共用一个键。这次归一在 POSIX 上不改变任何字节——那里的 `\` 是合法
// 文件名字符，当分隔符用会把 `my\proj` 这一真实目录拆成两段（separatorRuns 按 sep 分派，
// 正是为了把这条差异写成可注入、可测而不是一句注释）。
// realpath 失败（ENOENT：目录尚未创建；EACCES：无权限）时退回 resolve 结果继续——
// 键是从纯字符串算出来的，不能让文件系统状态把上报与检查打断。realpath 返回非字符串
// 同样只保留 resolve 结果：Node 的部分分支会以 `return;` 收手，不能让调用方吃到 TypeError。

import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * 可注入的选项。`realpath` 是同步 fs 调用，`sep` 决定**整条**路径语义分支：分隔符字形与
 * `resolve` 用的那套解析都由它选。两者注入是为了让两条分支在任何 runner 上都可判定——
 * `path.sep` 在模块装载时就定死了，而只注入字形会让非 POSIX runner 上的 POSIX 用例拿到
 * 原生解析结果，键随之漂移。
 */
export interface ProjectKeyOptions {
  realpath?: (target: string) => string;
  sep?: string;
}

/** Windows 认 `\` 与 `/` 两种字形，POSIX 只认 `/`。 */
const WINDOWS_SEPARATORS = /[/\\]+/gu;
/** POSIX 只合并重复斜杠，单个 `\` 留在文件名里。 */
const POSIX_SEPARATOR_RUNS = /\/{2,}/gu;

/**
 * 按平台分隔符选出要合并的字形。
 * @param sep - 平台分隔符（默认 `path.sep`）
 * @returns 用于 replaceAll 的全局正则
 */
function separatorRuns(sep: string): RegExp {
  return sep === "\\" ? WINDOWS_SEPARATORS : POSIX_SEPARATOR_RUNS;
}

/** Windows 的盘符根（`C:\`）→ `default`。裸 `C:` 是盘符相对，`resolve` 不会把它留到这里。 */
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:\\$/u;

/** 普通 UNC 共享根（`\\server\share\`，可带尾分隔符）。
 *  显式排除命名空间形态：服务器名不得含 `?`（`\\?\Volume...` 不是共享），不得以 `.`
 *  开头（`\\.\C:\` 已在归一那一步折成盘符路径），共享名不得含 `:`（流不是目录）。 */
const WINDOWS_UNC_ROOT = /^\\\\[^\\?.][^\\?]*\\[^\\/:?]+\\$/u;

/** 卷 GUID 根（`\\?\Volume{...}\`）。卷路径不能无损映射成盘符，保留自己的命名空间。 */
const WINDOWS_VOLUME_ROOT = /^\\\\\?\\Volume\{[^}]+\}\\$/iu;

/** `\\?\UNC\` / `\\.\UNC\` 前缀；`UNC` 标记按 Windows 规则不区分大小写。 */
const WINDOWS_EXTENDED_UNC = /^\\\\\?\\UNC\\/iu;
const WINDOWS_DEVICE_UNC = /^\\\\\.\\UNC\\/iu;

/** 扩展盘符 / 设备盘符前缀；只认 `\\?\C:` / `\\.\C:` 后跟分隔符或结束。 */
const WINDOWS_EXTENDED_DRIVE = /^\\\\\?\\[A-Za-z]:(?=\\|$)/u;
const WINDOWS_DEVICE_DRIVE = /^\\\\\.\\[A-Za-z]:(?=\\|$)/u;

/** 归一后的尾斜杠：取最终形态前要去掉。 */
const TRAILING_SLASHES = /\/+$/u;

/**
 * 为**根判定**折叠 Windows 命名空间前缀，只折叠能无损映射到普通路径的两类：
 * 扩展盘符/设备盘符（`\\?\C:\` / `\\.\C:\` → `C:\`）与扩展 UNC/设备 UNC
 * （`\\?\UNC\server\share` → `\\server\share`）。
 *
 * ⚠ 只用于根判定，不要拿它替换 `norm` 的输入。`\\?\C:\repo` 的哈希输入若也一起
 * 改写，非根扩展路径的键会从 `/?/C:/repo` 变成 `C:/repo`，那是键格式变更，需要
 * 旧键样本/对端规则支撑；本函数刻意不承担那一层。卷 GUID 保留前缀：没有盘符就
 * 无从证明它和某个 `C:\...` 是同一目录。
 *
 * 调用点在 `path.win32.resolve` 之后：`resolve` 会把 `\\?\C:\` 的尾分隔符吃掉，
 * 变成 `\\?\C:`；这里把无斜杠的 `C:` 补回卷根形，并先统一 `/` 再剥前缀，
 * `//?/C:/repo` 这类拼写才不会漏掉。
 * @param input - 已解析的 Windows 路径（可带尾分隔符）
 * @returns 仅用于根判定的折叠形
 */
function windowsRootCandidate(input: string): string {
  const unified = input.replaceAll("/", "\\");
  if (WINDOWS_EXTENDED_UNC.test(unified) || WINDOWS_DEVICE_UNC.test(unified)) {
    return `\\\\${unified.slice(8)}`;
  }
  if (WINDOWS_EXTENDED_DRIVE.test(unified) || WINDOWS_DEVICE_DRIVE.test(unified)) {
    const withoutPrefix = unified.slice(4);
    // `path.win32.resolve("\\?\C:\")` 会先去掉尾分隔符；这里把无斜杠的 `C:` 补回
    // 卷根形，避免它被当成盘符相对路径。
    return withoutPrefix.endsWith(":") ? `${withoutPrefix}\\` : withoutPrefix;
  }
  return unified;
}

/**
 * Windows 根判据：盘符根、UNC 共享根、卷 GUID 根。
 *
 * 用 `path.win32.parse` 的 `root` + `base` 而不是自己数段：卷 GUID 的根里有 `{}`，
 * UNC 的服务器名可以是 IPv6 字面量，手写“两段”正是这次误判的来源。`base === ""`
 * 排除“根下的普通目录”，根形再由三条正则收窄，未知命名空间（如 `\\?\GLOBALROOT`）
 * 不会冒充项目根。
 * @param candidate - 已解析的绝对 Windows 路径
 * @returns 是否为受支持的根
 */
function isWindowsRoot(candidate: string): boolean {
  const parsed = path.win32.parse(candidate);
  if (parsed.base !== "") {
    return false;
  }
  const root = parsed.root.endsWith("\\") ? parsed.root : `${parsed.root}\\`;
  return (
    WINDOWS_DRIVE_ROOT.test(root) || WINDOWS_UNC_ROOT.test(root) || WINDOWS_VOLUME_ROOT.test(root)
  );
}

/**
 * cwd → 项目键。非字符串 / trim 后为空 / 归一后落到根目录 → `"default"`
 * （与记忆网关的回退键名一致）。
 */
export function deriveProjectKey(cwd: unknown, opts?: ProjectKeyOptions): string {
  if (typeof cwd !== "string") {
    return "default";
  }
  const trimmed = cwd.trim();
  if (trimmed === "") {
    return "default";
  }
  // 引用而非调用 realpathSync 作默认值：node/no-sync 只放行显式注入的同步 fs 调用。
  const realpath = opts?.realpath ?? realpathSync;
  const sep = opts?.sep ?? path.sep;
  // 解析与字形必须同源：只把字形换成 POSIX 却留平台的 resolve，非 POSIX runner 上拿到的
  // 仍是拼过 cwd 的串，字面量键随之漂移。默认值两侧都等于各自平台的原生模块，键不变。
  const impl = sep === "\\" ? path.win32 : path.posix;
  let resolved = impl.resolve(trimmed);
  try {
    const canonical = realpath(resolved);
    // realpath 的返回类型在接口上是 string；运行期仍要挡住 undefined（见文件头）。
    if (typeof canonical === "string") {
      // 这里刻意只接收 realpath 的结果，不再折叠命名空间：非根扩展路径的哈希输入
      // 必须保持实际解析出来的拼写，键格式变更不在本函数里顺带完成。
      resolved = canonical;
    }
  } catch {
    /* 文件系统状态不参与键计算：保留 resolve 结果 */
  }
  // POSIX 的 `/` 去尾斜杠后变成空串；Windows 的盘符根、UNC 共享根与卷 GUID 根由
  // isWindowsRoot 判。根判定读的是 windowsRootCandidate 的折叠形，norm 仍读原拼写：
  // 修根不等于改写非根路径的哈希输入，这两件事在代码里必须分开。
  const norm = resolved.replaceAll(separatorRuns(sep), "/").replace(TRAILING_SLASHES, "");
  const atRoot = sep === "\\" ? isWindowsRoot(windowsRootCandidate(resolved)) : norm === "";
  if (atRoot) {
    return "default";
  }
  // norm 已把分隔符合并成单一 `/` 且非空、非根 → 尾段必非空（无需"空尾段"回退分支）。
  const last = norm.slice(norm.lastIndexOf("/") + 1);
  const safe = last.replaceAll(/\s+/gu, "_");
  const hash = createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 8);
  return `${safe}-${hash}`;
}
