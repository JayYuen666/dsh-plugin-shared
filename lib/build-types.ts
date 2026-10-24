// lib/build-types.ts —— 插件包声明产物（types/）的统一编排：先让 tsc 出声明，再把声明里
// 的相对说明符从源码后缀改写成产物后缀。
//
// 为什么需要后处理：源码按 NodeNext 约定写 `./lib/x.ts` 这种显式 `.ts` 后缀（基线 tsconfig
// 的 allowImportingTsExtensions + verbatimModuleSyntax 都要求它），而 tsc 的**声明**产物会把
// 说明符原样抄进 .d.ts——于是 `types/host.d.ts` 里留着 `from "./lib/x.ts"`，而包里根本没有
// 那个文件（只有 `types/lib/x.d.ts`）。`rewriteRelativeImportExtensions` 救不了：它只作用于
// JS 产物，不动声明。改成 `.js` 才是对的：TypeScript 把 `.js` 说明符解析到同名 `.d.ts`，
// 消费方因此解析到本包发出去的那份声明。
//
// 两阶段：编译进草稿目录、改写完成后再整体换上 types/。tsc 没开 noEmitOnError，有类型
// 错误时它照样写出一部分声明；直接编译进 types/ 的失败现场就是「既非完整也非空」的目录，
// 而调用方（测试）可能立刻读它。两阶段之后，失败留下的只是草稿目录，线上那份 types/
// 仍是上一轮完整的。
//
// tsc 入口由调用方解析注入（typescript 是各包自己的 devDependency；按调用方的依赖图
// resolve 才不依赖提升布局）。
import { execFileSync } from "node:child_process";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 声明构建的配置。 */
export interface TypesBuildOptions {
  /** 包根绝对路径（调用方的 `import.meta.dirname`）。 */
  readonly root: string;
  /** tsc 入口脚本的绝对路径（用 `process.execPath` 跑它，跨平台且不经 PATH / npx）。 */
  readonly tscEntry: string;
  /** tsconfig 项目名（相对包根）。缺省 `tsconfig.types.json`。 */
  readonly tsconfig?: string;
  /** 草稿目录绝对路径。缺省 `<root>/.tmp/types`（该目录在各包统一被 git 忽略，
   * 且与 types/ 同一文件系统，最后一步 rename 原子且不跨设备）。 */
  readonly scratch?: string;
  /** 产物目录绝对路径。缺省 `<root>/types`。 */
  readonly outDir?: string;
}

/**
 * 说明符位置的三种句法锚点：`… from "…"`、`import("…")` 与 `declare module "…"`。
 *
 * 判据必须锚在关键字上，不能按「引号里像路径」来认：`export type P = "./lib/foo.ts"` 里
 * 的字符串是一个字面量类型，它的值就是那串字符，改成 `.js` 等于悄悄改掉类型；JSDoc 示例
 * 里的路径同理。裸说明符（`node:fs`、`@deepseek-ai/…`）不命中相对段判据，一概不碰。
 *
 * 字符类不含 `\n`（跨行匹配会把两个相邻说明符并成一个）；后缀认 `mts`/`cts`（它们同样
 * 要改成对侧产物后缀）；`(?<!\.d)` 把 `.d.ts` 排除在外（那是声明文件自己的后缀）。
 */
const FROM_SPECIFIER = /(?<=\bfrom\s*)["']\.{1,2}\/[^"'\n]*?(?<!\.d)\.(?:mts|cts|ts)["']/gu;
const IMPORT_TYPE_SPECIFIER =
  /(?<=\bimport\(\s*)["']\.{1,2}\/[^"'\n]*?(?<!\.d)\.(?:mts|cts|ts)["']/gu;
const AUGMENTED_MODULE_SPECIFIER =
  /(?<=\bdeclare\s+module\s*)["']\.{1,2}\/[^"'\n]*?(?<!\.d)\.(?:mts|cts|ts)["']/gu;

/** 源码后缀 → 声明里该写的产物后缀（`.mts`/`.cts` 各自对侧，其余走 `.js`）。 */
const OUTPUT_EXTENSIONS = { cts: "cjs", mts: "mjs", ts: "js" } as const;

/** 说明符尾部（源码后缀 + 收尾引号）。 */
const SOURCE_SUFFIX = /\.(?<extension>mts|cts|ts)(?=["']$)/u;

/**
 * 把一处说明符里的源码后缀换成对侧产物后缀，引号与其内其余字符原样保留。
 * @param specifier - 带引号的说明符原文
 * @returns 改写后的说明符
 */
function withOutputSuffix(specifier: string): string {
  return specifier.replace(
    SOURCE_SUFFIX,
    (_match, extension: "cts" | "mts" | "ts") => `.${OUTPUT_EXTENSIONS[extension]}`,
  );
}

/**
 * 把一段声明正文里的相对源码后缀说明符改写成对侧产物后缀。
 *
 * 三处 replace 各自收一种句法位置，互不依赖；同一个文件里三种都出现时不漏也不重。
 * @param text - 声明文件正文
 * @returns 改写后的正文
 */
export function canonicalizeDeclarationSpecifiers(text: string): string {
  return text
    .replaceAll(FROM_SPECIFIER, withOutputSuffix)
    .replaceAll(IMPORT_TYPE_SPECIFIER, withOutputSuffix)
    .replaceAll(AUGMENTED_MODULE_SPECIFIER, withOutputSuffix);
}

/**
 * 把子进程的一路输出读成文本。
 *
 * `execFileSync` 不给 `encoding` 时两路都是 Buffer；按形态显式分支：文本原样用、Buffer
 * 按 UTF-8 解、其余形态返回空串。写成 `String(stream)` 会把 Buffer 送进默认字符串化，
 * 类型检查也会因为「可能是任意对象」而判红。
 * @param stream - 子进程的一路输出
 * @returns 文本
 */
export function textOf(stream: unknown): string {
  if (typeof stream === "string") {
    return stream;
  }
  if (Buffer.isBuffer(stream)) {
    return stream.toString("utf8");
  }
  return "";
}

/**
 * 跑一条命令；失败时抛出的信息取子进程自己的诊断文本，而不是包装层的壳。
 *
 * 用同步版：这是构建步骤，阻塞等 tsc 跑完完全够用，异步包装在这里只会为了一个用不上
 * 的并发度引入回调与 Promise 两种形态。两路都得收：tsc 把编译诊断写 **stdout**，工具
 * 自身崩溃与 node 的用法错误写在 stderr，任取一路都会丢一半。
 * @param file - 可执行文件（用 `process.execPath` 跑入口 JS，不经 npx：Windows 上 `npx`
 * 实际是 `npx.cmd`，`execFileSync` 不带 `shell` 不按 PATHEXT 解析，一律 ENOENT）
 * @param args - 参数
 * @param cwd - 工作目录
 */
export function runTool(file: string, args: readonly string[], cwd: string): void {
  try {
    execFileSync(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (error) {
    const streams =
      error instanceof Error && "stdout" in error && "stderr" in error
        ? [error.stdout, error.stderr]
        : [];
    const detail = streams
      .map((stream) => textOf(stream))
      .join("\n")
      .trim();
    throw new Error(detail === "" ? String(error) : detail, { cause: error });
  }
}

/**
 * 递归列出目录下的声明文件（`/` 分隔，路径相对 `dir`）。
 *
 * 文件与目录分成两支再汇总：混在一个 map 里时，只有文件的那一支会变成一个没有 `await`
 * 的 `async` 回调；拆开后两支各自理由完整。导出而非私藏：调用方的声明门禁要按同一口径
 * 列 types/，在调用方重写一份遍历逻辑只会让两边的目录形状悄悄分叉。
 * @param dir - 当前目录绝对路径
 * @param prefix - 已走过的相对前缀（顶层调用传空串）
 * @returns 命中的文件清单
 */
export async function listDeclarations(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith(".d.ts"))
    .map((entry) => `${prefix}${entry.name}`);
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => listDeclarations(path.join(dir, entry.name), `${prefix}${entry.name}/`)),
  );
  return [...files, ...nested.flat()];
}

/**
 * 产出 types/：跑 tsc 出声明，再逐个改写相对说明符，成功后整体换上。
 * @param options - 见 {@link TypesBuildOptions}
 * @returns 改写过的声明文件清单（相对 outDir、`/` 分隔）
 */
export async function buildDeclarations(options: TypesBuildOptions): Promise<string[]> {
  const scratch = options.scratch ?? path.join(options.root, ".tmp", "types");
  const outDir = options.outDir ?? path.join(options.root, "types");
  const tsconfig = options.tsconfig ?? "tsconfig.types.json";
  // 上一轮失败留下的草稿不该参与这次编译（tsc 不清 outDir，旧声明会被当成这次的结果）。
  await rm(scratch, { recursive: true, force: true });
  try {
    // tsc 没开 noEmitOnError，类型错误时照样写出一部分声明——编译这一步必须在 try 里，
    // 失败时半成品草稿才会被下面的 catch 清掉。
    runTool(
      process.execPath,
      [options.tscEntry, "-p", tsconfig, "--outDir", scratch],
      options.root,
    );
    const files = await listDeclarations(scratch, "");
    await Promise.all(
      files.map(async (file) => {
        const full = path.join(scratch, file);
        const text = await readFile(full, "utf8");
        await writeFile(full, canonicalizeDeclarationSpecifiers(text), "utf8");
      }),
    );
    // tsc 不清 outDir，删掉源文件后旧 .d.ts 会留在原地，而 `files` 里的 `types` 是整目录，
    // 陈旧声明照样发出去——所以替换而不是合并。先删旧的再改名：两步之间的空窗比「编译期
    // 一直空着」窄得多，而 rename 在同目录树内是原子的。
    await rm(outDir, { recursive: true, force: true });
    await rename(scratch, outDir);
    return files;
  } catch (error) {
    // 失败：清掉半成品，让上一次的 types/ 原样留着。
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
