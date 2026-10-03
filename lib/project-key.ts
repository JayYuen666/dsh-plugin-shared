// lib/project-key.ts —— cwd → 项目桶键的**单一来源**。
//
// 为什么存在：同一个"这次教训属于哪个项目"的判定有过两份逐字节重复的实现。键是持久化数据与
// 跨系统对照的桶名，双份实现意味着改一处漏一处——收敛到这里，两侧各留一个薄别名。
//
// 跨系统契约（不可动）：对端产出的是 `尾目录名-<sha256(norm) 前 8 位 hex>`。本模块**不改**
// 哈希算法、8 位切片与尾段空白清洗（动一位就等于把存量教训/记忆从原桶里搬走）；只在归一阶段
// 补两处真实缺陷：
//   1. path.resolve —— 相对路径与 `./`、`../` 冗余段不再各成一桶；
//   2. realpath —— 软链（macOS `/tmp` ↔ `/private/tmp`）指向同一目录时归一到同一桶。
// 不变式：POSIX 上输入已是"绝对且规范"的路径时，resolve 与 realpath 都是恒等变换，产出的键与
// 旧实现逐字节相同（test/project-key.test.ts 以字面量钉住），故 POSIX 存量桶不迁移。
// Windows 的分隔符另说：`\` 与 `/` 在 Win32 API 上同义，所以那里两种字形必须先折成一种，同一
// 目录的两种写法才共用一个桶。这条折叠在 POSIX 上不改变任何字节——那里的 `\` 是合法文件名字符，
// 当分隔符用会把 `my\proj` 这一真实目录拆成两段（separatorRuns 按 sep 分派，正是为了把这条
// 差异写成可注入、可测而不是一句注释）。
// realpath 失败（ENOENT：目录尚未创建；EACCES：无权限）时退回 resolve 结果继续——
// 桶键是纯字符串派生，不能让文件系统状态把上报/守卫热路径抛断。

import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * 可注入面。`realpath` 是同步 fs 调用，`sep` 决定**整条**路径语义臂：分隔符字形与 `resolve`
 * 用的那套解析都由它选。两者注入是为了让两条臂在任何 runner 上都可判定——`path.sep` 在模块
 * 装载时就定死了，而只注入字形会让非 POSIX runner 上的 POSIX 用例拿到原生解析结果，键随之漂移。
 */
export interface ProjectKeyOptions {
  realpath?: (target: string) => string;
  sep?: string;
}

/** Windows 认 `\` 与 `/` 两种字形，POSIX 只认 `/`。 */
const WINDOWS_SEPARATORS = /[/\\]+/gu;
/** POSIX 只折重复斜杠，单枚 `\` 留在文件名里。 */
const POSIX_SEPARATOR_RUNS = /\/{2,}/gu;

/**
 * 按平台分隔符选出要折叠的字形。
 * @param sep - 平台分隔符（默认 `path.sep`）
 * @returns 用于 replaceAll 的全局正则
 */
function separatorRuns(sep: string): RegExp {
  return sep === "\\" ? WINDOWS_SEPARATORS : POSIX_SEPARATOR_RUNS;
}

/** Windows 的盘符根（`C:\` 归一后剩 `C:`）；与 POSIX 的 `/` 同判，都落兜底桶。 */
const DRIVE_ROOT = /^[A-Za-z]:$/u;

/**
 * Windows 的 UNC 共享根（`\\server\share`，可带尾反斜杠）。
 *
 * 必须作用于**折分隔符之前**的串：折完它是 `/server/share`，与 POSIX 的 `/a/b` 无法区分，
 * 届时任何「两段即根」的判据都会误伤合法的 POSIX 目录。这里只匹配 UNC 自己的字形
 * （前导两个反斜杠），POSIX 路径与盘符路径都不命中。
 */
const UNC_ROOT = /^\\\\[^\\]+\\[^\\]+$/u;

/**
 * cwd → 项目桶键。非字符串 / trim 后为空 / 归一后落到根目录 → `"default"`
 * （与记忆网关的兜底桶名一致）。
 */
export function deriveProjectKey(cwd: unknown, opts?: ProjectKeyOptions): string {
  if (typeof cwd !== "string") {
    return "default";
  }
  const trimmed = cwd.trim();
  if (trimmed === "") {
    return "default";
  }
  // 引用而非调用 realpathSync 作默认值：node/no-sync 只放行显式注入的同步 fs 面。
  const realpath = opts?.realpath ?? realpathSync;
  const sep = opts?.sep ?? path.sep;
  // 解析与字形必须同源：只把字形换成 POSIX 却留平台的 resolve，非 POSIX runner 上拿到的
  // 仍是拼过 cwd 的串，字面量键随之漂移。默认值两侧都等于各自平台的原生模块，键不变。
  const impl = sep === "\\" ? path.win32 : path.posix;
  let resolved = impl.resolve(trimmed);
  try {
    resolved = realpath(resolved);
  } catch {
    /* 文件系统状态不参与键计算：保留 resolve 结果 */
  }
  // 归一后必是绝对路径（resolve 保证）。三种根都落 default，不给它们造一个冒充真实目录的桶：
  // POSIX 的 `/` 去尾斜杠后退化为空串；Windows 盘符根折完剩 `C:`；UNC 共享根（`\\server\share`）
  // 折完剩 `/server/share` —— 它的形貌与 POSIX 的两段目录**完全一样**，所以必须在折分隔符
  // **之前**判，折完就再也认不出来（实测 `\\server\share` 原先落成 `share-<hash>` 而非 default）。
  const stripped = resolved.replace(/[/\\]+$/u, "");
  const norm = resolved.replaceAll(separatorRuns(sep), "/").replace(/\/+$/u, "");
  if (norm === "" || DRIVE_ROOT.test(norm) || UNC_ROOT.test(stripped)) {
    return "default";
  }
  // norm 已把分隔符折成单一 `/` 且非空、非盘符根 → 尾段必非空（无需"空尾段"兜底分支）。
  const last = norm.slice(norm.lastIndexOf("/") + 1);
  const safe = last.replaceAll(/\s+/gu, "_");
  const hash = createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 8);
  return `${safe}-${hash}`;
}
