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
//
// ⚠ `--noResolve` 不是可选项：不加它 tsc 会**顺着 import 把整张图都编译一遍**，而复用它的产物
// 等于让流水线吃两份源码。带上它之后 tsc 只编这一个文件，且**模块说明符逐字保留**
// （`from "./judge-stats.ts"` —— 流水线的 `.ts` 解析照常）。代价是它对每个 import 报一条 TS2307
// （"找不到模块"）：那是 `--noResolve` 的必然产物而不是错误信号，所以这里**不看退出码**，只认
// "产物文件真的出来了"。
//
// ⚠ 这一步是**同步**的（`execFileSync`）且 stdout/stderr 默认丢弃：构建与测试的日志必须干净
// —— 上面那条"必然的 TS2307"绝不该出现在任何人的终端里。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { maskNonCode } from "./build-artifacts.ts";

/** 预转换的入参。 */
export interface DecoratorLoweringOptions {
  /** tsc 入口脚本的绝对路径（用 `process.execPath` 跑它，跨平台且不经 PATH / npx）。 */
  readonly tscEntry: string;
}

/** 临时目录前缀（`mkdtempSync` 会在它后面追加随机段）。 */
const TMP_PREFIX = "dsh-decorators-";

/** 带装饰器的 TS 源形状。
 *  它是"要不要跑一次 tsc"的**快速门槛** —— 绝大多数文件不该付这个子进程。
 *
 *  判据是「`@` 前面是空白或**能开启类表达式的结构位置**」：`{ ; ( , = : [ ? ! & | >`
 *  以及 `}` / `]` / `)` 之后都算。数组字面量（`[@dec class {}]`）与赋值/注释紧邻
 *  （`=/*c*\/@dec class {}`）都实测会漏，漏掉的后果是含装饰器的原文直接进流水线
 *  （正是文件头说的「产物是非法 JS、构建却报成功」）。
 *  反向的误判（正则字面量里出现 `@foo`）只多跑一次 tsc，不会产出错东西，所以这个
 *  方向不必收紧；字符串与注释里的 `@` 由 {@link maskNonCode} 先行遮蔽。 */
const DECORATOR_SYNTAX = /(?:^|[\s{;(,=:[?!&|>\]})])@[A-Za-z_$][\w$]*/u;

/** 声明文件不产出 JS：`.d.ts` / `.d.mts` / `.d.cts` 一律不进预转换。 */
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

/** TS 源后缀（`.ts` / `.mts` / `.cts`）。 */
const TS_FILE = /\.[cm]?ts$/u;

/** 降级产物里那行**永不生效**的 metadata 发布（锚点要求前缀与调用同行）。
 *  目标是**任意标识符**，不是固定写 `this`：tsc 按装饰器位置给出不同的接收者 —— 方法装饰器写
 *  `this`，类装饰器或静态成员写 `_classThis`，派生类写 `_classSuper` 一类临时名。 */
const METADATA_PUBLISH_LINE =
  /^\s*if \(_metadata\) Object\.defineProperty\([A-Za-z_$][\w$]*, Symbol\.metadata,/u;

/** tsc 产物文件尾的源映射注释（要删，但删行会让其后的源映射错位，所以用空行占位）。 */
const SOURCE_MAP_MARK = "//# sourceMappingURL=";

/** tsc 注入的两处调用：类静态块里的 `__esDecorate(…)`、构造器里的 `__runInitializers(…)`。 */
const INJECTED_CALL_MARKS: readonly string[] = ["__esDecorate(", "__runInitializers("];

/**
 * 这个文件需要预转换吗（声明文件、后缀与装饰器形状三道筛）。
 * @param id - 模块 id（可能带 query，调用方负责剥）
 * @param code - 源文本
 * @returns 需要预转换时为真
 */
export function needsDecoratorLowering(id: string, code: string): boolean {
  return TS_FILE.test(id) && !DECLARATION_FILE.test(id) && DECORATOR_SYNTAX.test(maskNonCode(code));
}

/**
 * 源文件后缀 → tsc 为它产出的 JS 后缀。
 *
 * 后缀门槛接受 `.mts` / `.cts`，而 tsc 对它们的产物是 `.mjs` / `.cjs`（不是 `.js`）。
 * 把后缀写死成 `.js` 时，这两种输入会去读一个不存在的文件，栈里只有一句 ENOENT。
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
 * 清理 tsc 注入的装饰器调用样板：删掉那行**永不生效**的 metadata 发布，并把注入的调用从
 * **源映射**里摘掉（不是给产物插提示）。两件事都是为了让四项 100% 的门禁只盯**我们手写的代码**。
 *
 * ① **metadata 发布**：降级产物里有
 *    `if (_metadata) Object.defineProperty(this, Symbol.metadata, { … });`，
 *    而 `_metadata` 来自 `typeof Symbol === "function" && Symbol.metadata ? … : void 0`。
 *    实测运行期 `typeof Symbol.metadata === "undefined"`（Node 26），所以那个 `if` 的真分支
 *    永远不走 —— 而它的源位置压在**我们那枚类声明**上，覆盖率就会盯着一个不可能为真的分支红。
 *    删掉它是安全的：官方 `Remote` 只往原型上写一枚方法描述符，**从不读 `context.metadata`**。
 * ② **注入的调用**（类静态块里的 `__esDecorate(…)`、构造器里的 `__runInitializers(…)`）：
 *    前者的上下文里带 TC39 为方法规定的 `access: { has, get }` 两枚箭头（官方实现同样不读
 *    `context.access`），后者对本类（没有实例字段初值）是纯噪音 —— 它们的源位置又恰好压在
 *    我们的类/构造器那两行上。做法是把这两行在**源映射**里的映射项置空。
 *
 * ⚠ 留痕落在**源映射**里而不是产物里：产物行保持逐字原样（插注释既改字节，又会让 `mappings`
 * 错位），只有 `coverageHints` 为真时把映射项置空。它只加给**测试流水线**：构建产物不该为
 * 覆盖率留任何形状。
 * ⚠ 只做**锚点明确的替换**：锚点对不上就原样返回（宁可让覆盖率当场红一次，也不猜着切文件）。
 * @param code - tsc 产物
 * @param coverageHints - 把注入的调用从源映射里摘掉（只有测试流水线要）
 * @param mapLines - tsc 的逐行源映射（产物行与它逐行对齐）；无源映射时为 null
 * @returns 清理后的产物与逐行映射
 */
function pruneInjectedPlumbing(
  code: string,
  coverageHints: boolean,
  mapLines: readonly string[] | null,
): { code: string; mapLines: string[] | null } {
  const out: string[] = [];
  const mapped: string[] = [];
  let cursor = 0;
  for (const line of code.split("\n")) {
    const sourceMapping = mapLines?.[cursor] ?? "";
    cursor += 1;
    if (METADATA_PUBLISH_LINE.test(line) && !line.trimEnd().endsWith(");")) {
      throw new Error(
        `dsh-plugin-shared: Symbol.metadata 发布语句不是单行（${line.trim().slice(0, 80)}…）：按行裁剪会留下残片，产物会是非法 JS。`,
      );
    }
    const dropped = METADATA_PUBLISH_LINE.test(line) || line.startsWith(SOURCE_MAP_MARK);
    const injected = INJECTED_CALL_MARKS.some((mark) => line.includes(mark));
    // 三种去向各占一行：整行抹掉（空行占位，行号不动）、保留但不归因、原样保留。
    out.push(dropped ? "" : line);
    mapped.push(dropped || (coverageHints && injected) ? "" : sourceMapping);
  }
  // 一条都没匹配上是**允许**的：前置门槛只筛"可能是装饰器"，正则字面量里出现 `@word`
  // 这类误报会白白跑一次 tsc，产物原样返回。
  return { code: out.join("\n"), mapLines: mapLines === null ? null : mapped };
}

/** 源映射形状（`mappings` 是逐行映射那一串，可选）。 */
interface SourceMapText {
  sources?: string[];
  sourcesContent?: string[];
  mappings?: string;
}

/**
 * `JSON.parse` 的结果是不是一份源映射。
 *
 * 不用 `as` 强转：基线的 `no-unsafe-type-assertion` 把「从 any 断言出来」判成 error，而
 * `JSON.parse` 的返回正是 any。判据只认**是对象**这一条 —— 里面的字段仍然由下面逐处可选访问，
 * 形状再怪也只会退化成「没有源映射」，不会把非法值带进覆盖率那条链。
 * @param value - 解析结果
 * @returns 可以按源映射处理时为真
 */
function isSourceMap(value: unknown): value is SourceMapText {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** tsc 产物与源映射（`map` 为 null 表示源映射缺席，不算致命）。 */
export interface LoweredDecorators {
  readonly code: string;
  readonly map: SourceMapText | null;
}

/**
 * 把一个带装饰器的 TS 文件编译成 JS。
 * @param code - 源文本（只进源映射的 `sourcesContent`；编译交给 tsc 读盘上的原文）
 * @param file - 源文件的**绝对路径**（tsc 按它定位产物名）
 * @param options - tsc 入口
 * @param coverageHints - 把注入的调用从源映射里摘掉（只有测试流水线要，见上）
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
  const outDir = mkdtempSync(path.join(tmpdir(), TMP_PREFIX));
  let tscStderr = "";
  try {
    try {
      execFileSync(
        process.execPath,
        [
          options.tscEntry,
          // 不吃调用方的 tsconfig：那一份是**只做类型检查**的（`noEmit`、`erasableSyntaxOnly`），
          // 而这一步要的正是它的反面。
          "--ignoreConfig",
          // 只编这一个文件：见文件头的理由（不加它会把整张图都编出来）。
          "--noResolve",
          "--target",
          "es2024",
          // `preserve` 让 import 说明符**逐字保留**（含 `.ts`），流水线照常解析。
          "--module",
          "preserve",
          // 源映射不是可选的：覆盖率按源文件归因，少了它被装饰的模块会从四项 100% 的门禁里
          // 凭空消失。
          "--sourceMap",
          "--outDir",
          outDir,
          file,
        ],
        // stdout 仍然丢弃：`--noResolve` 下那条**必然**的 TS2307 走 stdout，它不该出现在
        // 任何人的终端里。stderr 收下来只用于失败诊断（正常路径上一个字节都没有）。
        { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
      );
    } catch (error) {
      // 见文件头：`--noResolve` 下必有 TS2307，退出码不是可信信号 —— 产物在不在由下一句判。
      // 但原因要留下：tscEntry 缺失、参数不被识别、进程崩掉，与"只有 TS2307"在这里长得一样，
      // 最后都退化成 readFileSync 的 ENOENT。留着 stderr 才能把两者分开。
      // 否定支走不到：子进程是 `node <tscEntry>`，node 自己起不来（入口缺失、参数不认识、
      // 脚本抛错）时 stderr 一律是字符串。留着这三个判据是为了不让类型层面上的 `unknown`
      // 悄悄流进来 —— 真有一天换了调用方式，这里也不会变成 `[object Object]`。
      /* v8 ignore next 3 -- 见上：否定支在当前调用方式下不可达 */
      if (error instanceof Error && "stderr" in error && typeof error.stderr === "string") {
        tscStderr = error.stderr.trim();
      }
    }
    const emitted = path.join(
      outDir,
      `${path.basename(file).replace(TS_FILE, "")}${emittedExtensionOf(file)}`,
    );
    let js: string;
    try {
      js = readFileSync(emitted, "utf8");
    } catch (error) {
      // 产物没出来才算真失败。把 tsc 的 stderr 拼进来 —— 否则这里只剩一句 ENOENT，
      // 而"哪一步错了"是调用方唯一想知道的事。
      const detail = tscStderr === "" ? "（tsc 没有输出 stderr）" : tscStderr;
      throw new Error(
        `dsh-plugin-shared: 装饰器降级没有产出 ${path.basename(emitted)}（${file}）。tsc stderr：${detail}`,
        { cause: error },
      );
    }
    if (js.length === 0) {
      throw new Error(`dsh-plugin-shared: 装饰器降级没有产出任何字节（${file}）`);
    }
    let map: LoweredDecorators["map"] = null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(`${emitted}.map`, "utf8"));
      map = isSourceMap(parsed) ? parsed : null;
      // tsc 写的 `sources` 是**相对临时 outDir** 的路径，而那个目录紧接着就被删了 —— 这份映射
      // 交出去之后，任何按它解析的来源都指向不存在的路径，覆盖率归因与堆栈映射一起失效。
      // 改写成源文件的绝对路径，并把源文本一并带上。
      if (map !== null) {
        map.sources = [file];
        map.sourcesContent = [code];
      }
    } catch {
      // 源映射缺席不是致命项（覆盖率的归因会差一些，但那会由覆盖率门禁自己说话）。
    }
    const mappings = map?.mappings;
    const mapLines = mappings === undefined ? null : mappings.split(";");
    const pruned = pruneInjectedPlumbing(js, coverageHints, mapLines);
    if (map !== null && pruned.mapLines !== null) {
      map.mappings = pruned.mapLines.join(";");
    }
    return { code: pruned.code, map };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
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
      return needsDecoratorLowering(file, code)
        ? lowerStandardDecorators(code, file, options)
        : null;
    },
  };
}

/** Vite 插件（测试流水线）：与上面同源，只是挂到 Vite 的钩子上（`enforce: "pre"` 保证在它前面）。
 *  第三个实参 = 覆盖率提示：**只有测试流水线要**（构建产物的字节不该带它，见 pruneInjectedPlumbing）。 */
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
      return needsDecoratorLowering(file, code)
        ? lowerStandardDecorators(code, file, options, true)
        : undefined;
    },
  };
}
