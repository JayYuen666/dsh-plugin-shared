// lib/build-artifacts.ts —— 插件包构建脚本的通用机械件。
//
// 为什么收进 shared：这些件此前在各插件的 build-utils.mjs / build-*.mjs 里各带一份近似副本，
// 而副本的失效方式是「只修一侧」——原子落盘、输出守卫或直跑判据改在一处，其余仓仍是旧行为，
// 各仓测试又只覆盖自己那半，没有任何门会红。收敛之后，判据只有一处可改。
//
// 这里只放与具体产物形态无关的机械件；host / client / types 三条构建链各自的领域判断在
// 同目录的 build-host.ts / build-client.ts / build-types.ts。不进 barrel：构建期专用，
// 运行期消费方不该为它付导入（与 canonicalize-region-paths 同一条收录判据）。
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import type { InputOptions } from "rolldown";

/**
 * 对象守卫：数组与非对象都不算 Record。
 * @param raw - JSON.parse 之后的任意值
 * @returns 是否为普通对象
 */
export function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * 从 JSON.parse 的 unknown 投影为 Record（非对象 → 空对象兜底），避免 any 索引。
 * @param raw - JSON.parse 之后的任意值
 * @returns 普通对象；输入不是对象时为空对象
 */
export function asRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

/**
 * 读包根的 package.json，带上下文的失败信息。
 *
 * 惰性（调用时才读）而不是在消费方模块顶层读：顶层一次 JSON 语法错误会以未捕获的顶层
 * await 错误 + 裸 SyntaxError 收场，读者看不出是哪个文件坏了；而测试 import 构建模块时
 * 只为拿构建函数，不该连带付一次磁盘 I/O。
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
  // 兜底，而那个兜底会让人以为空 id 有专门处理。
  const firstSlash = id.indexOf("/");
  if (!id.startsWith("@")) {
    return firstSlash === -1 ? id : id.slice(0, firstSlash);
  }
  const secondSlash = firstSlash === -1 ? -1 : id.indexOf("/", firstSlash + 1);
  return secondSlash === -1 ? id : id.slice(0, secondSlash);
}

/**
 * rolldown 输出项的最小投影：单文件产物只关心这几项。
 * `moduleIds` 之类不进投影——本类型只判形状，多一层声明就多一处与 rolldown 版本耦合的面，
 * 而调用方拿到的仍是原始输出项，不缺字段。
 */
export interface OutputItem {
  readonly type: string;
  readonly fileName: string;
  readonly code?: string | undefined;
  readonly isEntry?: boolean | undefined;
  readonly moduleIds?: readonly string[] | undefined;
}

/**
 * 单文件产物只接受一个带正文的 entry chunk。
 *
 * 正文还必须非空白：`typeof code === "string"` 会放行空串与纯空白，而那两态落盘后是
 * 一份语法上能解析、跑起来什么都不做的产物——构建报成功，宿主那条路静默不渲染。
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
 * 单文件产物只允许一个 entry chunk：多余 chunk / asset 不落盘，产物要到运行时才因缺模块而炸。
 * 这是「静默不渲染」同一类难查故障，所以在构建期就失败。
 * @param output - rolldown 的 generate 输出清单
 * @param source - 入口源码名（错误信息点名用）
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
  return chunk;
}

/** Windows 上目标文件被占用时的错误码：EPERM 来自只读/映射文件，EBUSY 来自被打开的文件。 */
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
/** 重试的等待序列（毫秒）。总等待控制在半秒内：占用者通常是杀毒/索引服务，退避即可。 */
const RENAME_RETRY_DELAYS_MS = [50, 100, 200];

/**
 * rename 的 Windows 退避重试。
 *
 * POSIX 上 rename 换目录项是原子的，失败即真失败；Windows 上目标文件被其它进程持有
 * （Electron / dev server 正 require 产物、杀毒或索引服务短暂占用）时会给 EPERM/EBUSY，
 * 而占用通常在几十毫秒内释放。不重试的话这条失败是**间歇性**的：同一棵树连着构建两次，
 * 一次红一次绿。其余错误码照旧立即抛出——真的没权限时重试只是拖慢失败。
 * @param from - 草稿文件
 * @param to - 目标文件
 * @param attempt - 已重试次数
 */
async function renameWithRetry(from: string, to: string, attempt = 0): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    // 只按「有没有 code 字段」判形态：Node 的 fs 错误都带 code，其余异常一律原样上抛。
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (typeof code !== "string" || !RENAME_RETRY_CODES.has(code)) {
      throw error;
    }
    const delay = RENAME_RETRY_DELAYS_MS.at(attempt);
    if (delay === undefined) {
      throw error;
    }
    // 退避后重试同一对路径。写成递归而不是 for 里 await：这里每一步都**必须**等上一步结束，
    // 没有可并行的空间，而 for + await 会让「顺序」看起来像可以改成 Promise.all 的并行。
    await sleep(delay);
    await renameWithRetry(from, to, attempt + 1);
  }
}

/**
 * 原子落盘：目标目录下 `.tmp/` 草稿 + rename；失败时清掉草稿再抛。
 *
 * 草稿落在**目标文件所在目录**下的 `.tmp/`，不是 `os.tmpdir()`，也不是产物旁边的裸名：
 *   - 不用 `os.tmpdir()`：rename 只在同一文件系统内原子，跨设备会以 EXDEV 失败，而系统临时
 *     目录常被挂到另一个分区/卷；
 *   - 跟随目标目录而不是写死包根：本函数住在公共库里，产物落点由调用方决定；
 *   - 不用「产物名 + 后缀」直接落在产物旁边：那个名字通常不在 `.gitignore` 里，构建被中断
 *     时半份产物会以未跟踪文件出现在 `git status`，被误当成源码改动提交。`.tmp/` 是各包
 *     统一忽略的目录，不需要为构建残留单独扩忽略规则。
 *
 * 失败信息带上两个路径并保留 cause：裸 `ENOENT … open '…/<uuid>.tmp'` 把注意力引到草稿名上，
 * 读者还得自己剥出真正的产物路径。
 * @param target - 目标文件绝对路径
 * @param text - 产物正文
 */
export async function writeArtifact(target: string, text: string): Promise<void> {
  const scratchDir = path.join(path.dirname(target), ".tmp");
  await mkdir(scratchDir, { recursive: true });
  const scratch = path.join(
    scratchDir,
    `${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(scratch, text, "utf8");
    await renameWithRetry(scratch, target);
  } catch (error) {
    // 清草稿本身可能失败（Windows 上 EBUSY/EPERM，`force` 只吞 ENOENT），那一下抛出去会把
    // 真正的写盘错因盖掉。随机后缀保证残留草稿不会与下一次构建撞名。
    try {
      await rm(scratch, { force: true });
    } catch {
      // 见上：清理失败不值得盖住错因。
    }
    throw new Error(`写产物失败：${target}（草稿 ${scratch}）：${String(error)}`, { cause: error });
  }
}

/** 异常路径上释放 rolldown bundle 的最小形状。 */
export interface CloseableBundle {
  readonly close: () => Promise<void>;
}

/** generate 交给调用方的最小输出形状（属性式签名，真实 bundle 结构满足）。 */
export interface RolldownBundle extends CloseableBundle {
  readonly generate: (options: {
    format: "esm" | "cjs";
    minify?: boolean;
    comments?: boolean;
  }) => Promise<{ output: readonly OutputItem[] }>;
}

/**
 * 调用方注入的 rolldown 构造器。
 *
 * 注入而不是由本包声明依赖：rolldown 是各包构建期自己的 devDependency，本包作为库
 * 不该为构建工具声明运行期依赖面。参数类型借 rolldown 自己的 InputOptions（仅类型
 * 导入，产物里没有它）。
 */
export type RolldownFactory = (options: InputOptions) => Promise<RolldownBundle>;

/**
 * 异常路径上释放 rolldown bundle：close 失败只记日志，不覆盖调用方正在抛的原始错因。
 *
 * bundle 持有原生资源，generate 或输出守卫抛错时同样要释放；但那时唯一有价值的日志是
 * 「构建为什么失败」，让一条关于资源释放的噪音顶掉它，排障就从「读一行」变成「猜」。
 * 成功路径不要用本函数：那里 close 失败仍应判红，资源没释放是构建器的问题。
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
 * argv[1] 可能缺席或是软链路径（pnpm 场景、`/tmp` → `/private/tmp`），两边折成 realpath
 * 再比；裸字符串比较会让直跑分支被静默跳过，脚本挂在 prepare / prepack 上时等于发布
 * 过期产物而不报错。
 *
 * 两种失败必须分开：argv[1] 不是本文件（被 import、或被别的脚本调用）→ 安静返回 false；
 * 基名就是本文件却解不出 realpath（软链断了、父目录 EACCES、argv[1] 已被删除）→ 直接抛。
 * 后者若也返回 false，脚本会既不构建也不报错、以 0 退出，发布链路认为构建成功而磁盘
 * 产物仍是旧的。
 * @param moduleFile - 调用方的 `import.meta.filename`
 * @returns 是否直接运行
 */
export function invokedDirectly(moduleFile: string): boolean {
  const entry = process.argv.at(1);
  if (entry === undefined || entry.length === 0) {
    return false;
  }
  if (path.basename(entry) !== path.basename(moduleFile)) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(moduleFile);
  } catch (error) {
    throw new Error(`无法解析本脚本自身的路径（argv[1]=${entry}）：构建未发生，不要当成成功。`, {
      cause: error,
    });
  }
}
