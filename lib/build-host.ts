// lib/build-host.ts —— 插件包 host 侧产物的统一编排：每个入口单独一次 rolldown，
// 打成自包含单文件 ESM，落包根。
//
// 为什么必须有这一步：Node 对 node_modules 里的 .ts 直接抛
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING（实测），而发布出去的包正是在
// node_modules 里被 dsh 载入的；官方示例包（docs/user/develop/publish.zh.md 的
// hello-plugin）也是包根放产物。host 入口与产物同目录，`import.meta.dirname`
// 的语义与源码态完全一致。
//
// 调用方（各包根的 build-host.mjs）只声明入口表与产物头；外部化规则、输出检查、
// 规范化与结构性判断都在这里，一处可改。rolldown 由调用方注入：它是各包自己的
// devDependency，本包不为构建工具声明运行期依赖。
import path from "node:path";
import type { CommentsOptions, RolldownPluginOption } from "rolldown";
import {
  asRecord,
  closeQuietly,
  escapeRegExp,
  isRecord,
  packageNameOf,
  packagePatternOf,
  readManifest,
  singleEntryChunk,
} from "./build-artifacts.ts";
import type { RolldownFactory } from "./build-artifacts.ts";

/**
 * 压缩 host 产物的注释档位：只留法律注释。
 *
 * `comments: false` 会把随包发布的第三方许可头一并抹掉；三档必须一起写，只给 `legal` 时
 * annotation 与 jsdoc 仍取缺省 true，产物会多出若干 `@__PURE__` 标注字节。
 */
const LEGAL_COMMENTS: CommentsOptions = { legal: true, annotation: false, jsdoc: false };

/**
 * shared 的工具面在消费方产物里是 external：`/tool` 已被构建期拆成 `internal/tool/<module>`，
 * 但 rolldown 不会去读被 external 包的 `sideEffects: false`。一个具名导入在 tree shaking 后
 * 只剩副作用时，产物会留下 `import "…/internal/tool/x"`——这段导入没有绑定，却在运行期
 * 让 Node 真正加载并求值那个模块。shared 的 package.json 已声明 `sideEffects: false`，
 * 这里把同一事实显式交给 rolldown 的 `treeshake.moduleSideEffects`，让它把这类空导入整条删掉。
 *
 * 只匹配工具面（`/tool` 与 `/internal/tool/*`），不碰 `/client`：后者是宿主模块表里的单例，
 * 语义上不该由这条构建期规则替它决定副作用。
 */
const SHARED_TOOL_SIDE_EFFECTS = /^@jayyuen66\/dsh-plugin-shared\/(?:tool|internal\/tool\/)/u;

/**
 * 注释键的三态分派：显式 false 抹掉、未给定且压缩时降到 legal-only、其余省略键。
 *
 * 与客户端侧同源（lib/build-client.ts 的 generateOptionsOf）。显式 `comments: true` 必须
 * 保持「省略键」——rolldown 对「显式缺省值」与「省略键」不承诺逐字节同形，而各仓的新鲜度检查
 * 是逐字节比磁盘产物。
 * @param comments - 调用方的声明
 * @param minify - 是否压缩
 * @returns 要合并进 generate 选项的那一条片
 */
function commentOptionOf(
  comments: boolean | undefined,
  minify: boolean,
): { comments?: CommentsOptions | false } {
  if (comments === false) {
    return { comments: false };
  }
  return comments === undefined && minify ? { comments: LEGAL_COMMENTS } : {};
}

/** 一个 host 入口：源码、产物与生成头。多个入口各自单独构建，互不共享 chunk。 */
export interface HostEntry {
  /** 入口源码（相对包根，如 `host.ts`）。 */
  readonly source: string;
  /** 产物文件名（相对包根，如 `host.js`）。 */
  readonly output: string;
  /** 产物首行的 GENERATED 头（含行尾换行）。它是产物字节的一部分，逐字由调用方给定。 */
  readonly header: string;
}

/** host 侧构建的完整配置。 */
export interface HostBuildOptions {
  /** 包根绝对路径（调用方的 `import.meta.dirname`）。 */
  readonly root: string;
  /** 调用方注入的 rolldown。 */
  readonly rolldown: RolldownFactory;
  /** 入口表。每项单独一次构建：多输入会把公共依赖提成共享 chunk，这里要的是自包含单文件。 */
  readonly entries: readonly HostEntry[];
  /** 压缩产物。缺省不压；装载器只 `import()` 文本，注释与空白是真实装载成本。 */
  readonly minify?: boolean;
  /** 保留注释。缺省跟随 minify（压缩则只保留 legal comments，不压缩则全保留）。 */
  readonly comments?: boolean;
  /** rolldown 插件（如装饰器预转换）。缺省无。类型借 rolldown 自己的插件形状（仅类型导入）。 */
  readonly plugins?: RolldownPluginOption;
  /** 解析扩展名表，**替换** rolldown 默认值而非追加。缺省 `[".ts", ".mjs", ".js"]`；
   * 入口会导入 `.json` 数据的包要显式带上 `.json`。 */
  readonly resolveExtensions?: readonly string[];
  /** 是否外部化 optionalDependencies。缺省外部化：「装上就用、没装也能跑」的语义由
   * 运行期 require 决定，内联会把可选实现固定进产物、抹掉「可选」这层语义。
   * 个别包刻意反向（可选依赖内联成「缺包时功能照旧」），传 false。 */
  readonly externalizeOptional?: boolean;
  /**
   * 要**内联**的说明符（裸包名或子路径），从依赖段的外部化集合里精确摘出来。
   *
   * 典型用法是 shared 的纯工具面：`@jayyuen66/dsh-plugin-shared/tool`。只摘这一条子路径，
   * 同包的 `/client` 仍保持 external（它是宿主模块表里的单例行）。不能直接删整个包名：
   * 那样会把同包其它子路径一起内联，模块级状态会被复制。
   *
   * 说明符必须属于 dependencies / peerDependencies（及按选项计入的 optionalDependencies），
   * 否则立即抛错——打错一个字不应退化成「整包仍 external」的静默成功。
   */
  readonly inline?: readonly string[];
}

/** 一个 host 产物的构建结果。`inlinedModules` 是结构性外部化检查的判断依据。 */
export interface HostArtifact {
  readonly source: string;
  readonly output: string;
  /** 产物绝对路径。 */
  readonly file: string;
  /** 产物完整正文（含生成头）。 */
  readonly code: string;
  /** 被打进 chunk 的模块 id 清单。外部化的依赖不出现在这里——依赖表里的包名一旦
   * 出现，就是有人把它从外部化名单里挪走了（内联）。 */
  readonly inlinedModules: readonly string[];
}

/**
 * 取依赖表里的包名清单（返回值即外部化用的说明符）。
 *
 * 两类坏形状都立即失败，不折成空集静默继续：表存在但不是对象时，外部化名单会整表失效；
 * 条目值不是字符串时，那个包会被静默少外部化一个。两种形态的症状都只出现在宿主运行期
 * （依赖被内联、模块级状态复制成多份），而构建期一路通过——所以宁可失败在构建机上。
 * @param manifest - 解析后的 package.json
 * @param field - 依赖段名
 * @returns 包名清单
 */
function dependencyNames(manifest: Record<string, unknown>, field: string): string[] {
  const table = manifest[field];
  if (table === undefined) {
    return [];
  }
  if (!isRecord(table)) {
    const shape = Array.isArray(table) ? "array" : typeof table;
    throw new TypeError(
      `package.json 的 ${field} 不是对象（实为 ${shape}）。折成空集会让外部化名单失效、依赖全部内联进产物，所以拒绝继续。`,
    );
  }
  return Object.keys(table).map((name) => {
    if (typeof table[name] !== "string") {
      throw new TypeError(
        `package.json 的 ${field}.${name} 不是字符串范围（收到 ${typeof table[name]}）。` +
          "静默跳过会让这个包被当成内部依赖整包内联，而内联恰好复制它的模块级状态。",
      );
    }
    return name;
  });
}

/**
 * 三个依赖段合出的外部化名单。
 * @param manifest - 解析后的 package.json
 * @param externalizeOptional - 是否计入 optionalDependencies
 * @returns 包名段集合
 */
function externalNamesOf(
  manifest: Record<string, unknown>,
  externalizeOptional: boolean,
): Set<string> {
  const names = [
    ...dependencyNames(manifest, "dependencies"),
    ...dependencyNames(manifest, "peerDependencies"),
  ];
  if (externalizeOptional) {
    names.push(...dependencyNames(manifest, "optionalDependencies"));
  }
  return new Set(names);
}

/**
 * 外部化正则：整包 external，但把 `inline` 里点名的子路径精确放行给打包器。
 *
 * 为什么不用「把包名从 external 集合删掉」：那会连同一包的 `/client` 等兄弟子路径一起内联。
 * 这里给每个包生成 `^pkg(?:/(?!排除项$).*)?$`：包根与其它子路径仍命中，只有登记的那一条
 * 不命中，交给 rolldown 解析并 tree-shake。
 * @param names - 依赖段合出的包名集合
 * @param inline - 要内联的说明符集合
 * @returns 用于 rolldown `external` 的正则数组
 */
function externalPatternsOf(names: ReadonlySet<string>, inline: ReadonlySet<string>): RegExp[] {
  const patterns: RegExp[] = [];
  for (const name of names) {
    if (!inline.has(name)) {
      const suffixes = [...inline]
        .filter((specifier) => specifier.startsWith(`${name}/`))
        .map((specifier) => specifier.slice(name.length + 1));
      if (suffixes.length === 0) {
        patterns.push(packagePatternOf(name));
      } else {
        const excluded = suffixes.map((suffix) => escapeRegExp(suffix)).join("|");
        patterns.push(new RegExp(`^${escapeRegExp(name)}(?:/(?!${excluded}$).*)?$`, "u"));
      }
    }
  }
  return patterns;
}

/**
 * `moduleIds` 必须是**非空的字符串数组**。
 *
 * 只判「是数组」会让两种坏形状通过检查：空清单（下游「依赖一个都没被内联」这条结构性判断
 * 没有样本，于是永远成立）与非字符串元素（按 `node_modules/` 切包名的那条分支会静默落空）。
 * @param raw - chunk 上的 moduleIds
 * @returns 是否为非空字符串数组
 */
function isModuleIdList(raw: unknown): raw is readonly string[] {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((id) => typeof id === "string" && id.length > 0)
  );
}

/**
 * 构建全部 host 入口。
 *
 * 各入口单独一次 rolldown 并发跑（它们互不依赖，串行只是在等第二次构建）；模块横幅的
 * 路径基准由 rolldown 的 `cwd` 选项固定成包根，产物正文不再做文本后处理。
 * @param options - 见 {@link HostBuildOptions}
 * @returns 与入口表同序的产物清单
 */
export async function buildHostEntries(options: HostBuildOptions): Promise<HostArtifact[]> {
  const manifest = asRecord(await readManifest(options.root));
  const externalNames = externalNamesOf(manifest, options.externalizeOptional ?? true);
  // 空集是本流程最省事的一种坏法：依赖被整包内联、模块级状态复制成多份，而构建依然
  // 退出 0。这里立即抛出失败，不留给产物侧的断言去发现。
  if (externalNames.size === 0) {
    throw new Error(
      "package.json 的 dependencies / peerDependencies 都取不到字符串条目，外部化集合为空——依赖会被整包内联。",
    );
  }
  // 外置规则用正则数组而不是判定函数：rolldown 官方文档写明函数形态每个模块回调一次 JS，
  // 开销显著；正则数组在 Rust 侧一次遍历即可，且 `^pkg(/|$)` 保持「按包名段命中子路径」的
  // 语义（字符串项是全等匹配，写 "pkg" 不命中 pkg/sub）。产物字节与函数形态逐字节相同。
  const inline = new Set(options.inline);
  for (const specifier of inline) {
    const name = packageNameOf(specifier);
    if (!externalNames.has(name)) {
      throw new Error(
        `inline 说明符 ${specifier} 不属于依赖段（dependencies / peerDependencies` +
          `${(options.externalizeOptional ?? true) ? " / optionalDependencies" : ""}）——` +
          "拼错或包名过期时立即失败，避免退化成整包仍 external。",
      );
    }
  }
  const externalPatterns = externalPatternsOf(externalNames, inline);
  const resolveExtensions = options.resolveExtensions ?? [".ts", ".mjs", ".js"];
  const minify = options.minify ?? false;
  // 省略键在缺省态是承重的：rolldown 对「显式缺省值」与「省略键」不承诺逐字节同形，而消费方的
  // 产物一致性检查是逐字节比对——省略键正是各仓旧脚本的实际调用形状。三态的分派与客户端侧
  // 同源（见 lib/build-client.ts 的 generateOptionsOf）：显式 true 照旧全留，显式 false 整片
  // 抹掉，未给时压缩态降到 legal-only。
  const { comments } = options;
  const generateOptions = {
    format: "esm" as const,
    ...(minify ? { minify: true } : {}),
    ...commentOptionOf(comments, minify),
    codeSplitting: false,
    dynamicImportInCjs: false,
  };

  const buildEntry = async (entry: HostEntry): Promise<HostArtifact> => {
    const bundle = await options.rolldown({
      input: path.join(options.root, entry.source),
      external: externalPatterns,
      platform: "node",
      // 被 external 的 shared 工具面按 package.json 的 sideEffects:false 交给 tree shaking：
      // 见 SHARED_TOOL_SIDE_EFFECTS 的说明。只对这一个包的工具子路径生效。
      treeshake: {
        moduleSideEffects: [{ test: SHARED_TOOL_SIDE_EFFECTS, external: true, sideEffects: false }],
      },
      // 固定 rolldown 的 cwd：`// <path>` 行按这个 cwd 算相对路径，不固定它同一份源码在
      // 包根与子目录下会产出两种字节（跨 cwd 构建不可复现）。
      cwd: options.root,
      resolve: { extensions: [...resolveExtensions] },
      ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    });
    let artifact: HostArtifact;
    try {
      const { output } = await bundle.generate(generateOptions);
      const chunk = singleEntryChunk(output, entry.source);
      if (!isModuleIdList(chunk.moduleIds)) {
        throw new TypeError(
          `rolldown 为 ${entry.source} 产出的 entry chunk 的 moduleIds 不是"非空字符串数组"`,
        );
      }
      // 模块横幅的路径基准是 rolldown 的 `cwd`（上面已固定成包根），不是 process.cwd()。
      // 因此这里不再做文本后处理：同一份源码在任意调用方 cwd 下都产出同一串字节，内存构建
      // 与磁盘产物直接逐字节可比；文本改写反而会把字符串字面量里同形的行改掉。
      const code = chunk.code.trimEnd();
      artifact = {
        source: entry.source,
        output: entry.output,
        file: path.join(options.root, entry.output),
        code: `${entry.header}${code}\n`,
        inlinedModules: chunk.moduleIds,
      };
    } catch (error) {
      // bundle 持有原生资源，异常路径同样要释放；closeQuietly 保证释放失败不盖掉这里的错因。
      await closeQuietly(bundle);
      throw error;
    }
    // 成功路径不用 closeQuietly：那里 close 失败仍应判定失败，资源没释放是构建器的问题。
    await bundle.close();
    return artifact;
  };

  return Promise.all(options.entries.map((entry) => buildEntry(entry)));
}
