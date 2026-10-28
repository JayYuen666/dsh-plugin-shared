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
import type { RolldownPluginOption } from "rolldown";
import { canonicalizeRegionPaths } from "./canonicalize-region-paths.ts";
import {
  asRecord,
  closeQuietly,
  isRecord,
  packageNameOf,
  readManifest,
  singleEntryChunk,
} from "./build-artifacts.ts";
import type { RolldownFactory } from "./build-artifacts.ts";

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
  /** 保留注释。缺省跟随 minify（压缩则移除，不压缩则保留）。 */
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
 * 取依赖表里的包名清单（值即外部化说明符）。
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
 * `moduleIds` 必须是**非空的字符串数组**。
 *
 * 只判「是数组」会让两种坏形状通过检查：空清单（下游「依赖一个都没被内联」这条结构性判断
 * 没有样本，于是恒真）与非字符串元素（按 `node_modules/` 切包名的那一侧会静默落空）。
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
 * 各入口单独一次 rolldown 并发跑（它们互不依赖，串行只是在等第二次构建）；产物正文
 * 先按 `process.cwd()` 无关的 canonical 形态规范化，再交给调用方写入磁盘。
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
  const isExternal = (id: string): boolean => externalNames.has(packageNameOf(id));
  const resolveExtensions = options.resolveExtensions ?? [".ts", ".mjs", ".js"];
  const minify = options.minify ?? false;
  const comments = options.comments ?? !minify;
  // 只在偏离缺省时下发这两个键：rolldown 对「显式缺省值」与「省略键」并不承诺逐字节
  // 同形，而消费方的产物新鲜度检查是逐字节比对——省略键是各仓旧脚本的实际调用形状。
  const generateOptions = {
    format: "esm",
    ...(minify ? { minify: true } : {}),
    ...(comments ? {} : { comments: false }),
  } as const;

  const buildEntry = async (entry: HostEntry): Promise<HostArtifact> => {
    const bundle = await options.rolldown({
      input: path.join(options.root, entry.source),
      external: isExternal,
      platform: "node",
      // 固定 rolldown 的 cwd：`//#region` 行按 process.cwd() 算路径，不固定它同一份源码在
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
      // `//#region` 行的路径由 rolldown 按 process.cwd() 算出 ⇒ 同一份源码有两种字节。改写成
      // canonical 必须落在**返回值之前**：调用方的新鲜度检查拿内存构建与磁盘产物逐字节比，
      // 只在一侧改就永远失败。
      const code = canonicalizeRegionPaths(chunk.code.trimEnd(), options.root, process.cwd());
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
