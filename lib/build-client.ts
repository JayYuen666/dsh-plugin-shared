// lib/build-client.ts —— 插件包 client 侧产物的统一编排：rolldown 把客户端入口打包为
// CJS（react 家族精确外置），再包进 window.__ModuleLoader__.load({ id, factory }) 的 外壳 里。
// id 取 package.json 的 name，与 dsh.client 模块表键一致。
//
// 调用方（各包根的 build-client.mjs）声明入口、产物头与包名同源校验；外置规则、
// store 路径改写与 外壳 拼装都在这里。rolldown 由调用方注入（各包自己的 devDependency）。
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CommentsOptions, Plugin } from "rolldown";
import {
  asRecord,
  closeQuietly,
  externalPatternOf,
  packageNameOf,
  readManifest,
  singleEntryChunk,
} from "./build-artifacts.ts";
import { collectRequireCalls } from "./require-calls.ts";
import type { RequireCallFacts } from "./require-calls.ts";
import type { ParseSourceAst } from "./decorator-lowering.ts";
import type { RolldownFactory } from "./build-artifacts.ts";

/**
 * 宿主 seed 表里 react 家族的全部模块说明符——客户端产物只外置宿主真给得出的模块。
 * 与宿主客户端自己的模块表同源：那张表里 react 家族只有这四条。外置清单更大的包
 * （宿主 外壳 的 PLATFORM_MODULES，即宿主平台模块表，扩容后）由调用方在 `externals` 里给全量清单。
 */
export const REACT_RUNTIME_MODULES: readonly string[] = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
];

/** 注释行里 pnpm store 段的匹配锚：行首、可选 region 前缀、任意相对段、store 层。 */
const STORE_PATH_COMMENT =
  /^\/\/(?:#region | )?(?:\.\.?\/)*node_modules\/\.pnpm\/[^/]+\/node_modules\//u;
/** 兜底检查只认这个子串，与注释行形态无关。 */
const STORE_PATH_LEFTOVER = /node_modules\/\.pnpm\//u;
/** npm 允许的包名字符集（含 scope）。 */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;

/**
 * 把注释行里的 pnpm 内容寻址段（store 目录里带「名@版_哈希」的那一层）改写成普通的
 * `node_modules/` 一层。
 *
 * 为什么 client 侧需要而 host 侧不需要：host 把依赖全外部化，产物里没有依赖的模块标记；
 * client 必须把共享库的模块**内联**（浏览器解析不了裸说明符），于是 rolldown 写下的标记里
 * 带着依赖版本与本机 store 哈希。带着它发布，同一份源码在不同机器上产出不同字节（跨机器
 * 不可复现），还把安装布局公开进公共 tarball。
 *
 * 两种横幅形态都接受：`//#region`（HMR 载荷/旧产物）与 `//`（当前生产构建）。从 registry
 * 安装时（消费仓 CI 的 frozen 安装正是这个形状）同一批模块的横幅路径里带
 * `.pnpm/<名>@<版>_<peer 后缀>` 那一层；只认一种形态时，另一种的 store 段会原样留在产物里，
 * 下面的兜底检查把整次构建判定失败——0.1.8 就是在这个形状上失败的，而工作区软链安装碰不到
 * `.pnpm`，所以本地检查与发布前的全部检查都看不见它。
 *
 * 改写必须覆盖整段而不是只换中段：store 段之上还可能带着 `../` 前缀（依赖落在工作区根
 * 一侧时就是这样），只换中段会留下 `../../node_modules/<包名>/…`，产物字节仍然随检出
 * 深度变，等于没改。所以匹配锚在行首、允许任意个相对段。
 *
 * 反斜杠先归一：Windows 上 rolldown 可能写 `\`，而这行是注释、整行只有路径，归一不会
 * 误伤代码。改写完再验一遍「整份产物里不剩 `.pnpm` 段」——静默未命中是这条改法最坏的
 * 失效形态：匹配锚在注释行的形状上，而 rolldown 一旦改写成别的行形态，改写会一处都
 * 不命中，兜底检查若也跟着只用同一套形状假设，就会一起静默失效。`node_modules/.pnpm/`
 * 这个子串与行形态无关。
 * @param code - chunk 正文
 * @returns 改写后的正文
 */
export function collapseStorePaths(code: string): string {
  const collapsed = code.replaceAll(/^\/\/(?:#region .*| .*)$/gmu, (line) =>
    line
      .replaceAll("\\", "/")
      .replace(STORE_PATH_COMMENT, (matched) =>
        matched.startsWith("//#region") ? "//#region node_modules/" : "// node_modules/",
      ),
  );
  const leftover = STORE_PATH_LEFTOVER.exec(collapsed);
  if (leftover !== null) {
    const at = Math.max(0, leftover.index - 40);
    throw new Error(
      `产物里仍有 pnpm store 路径未折叠（出现在 …${JSON.stringify(collapsed.slice(at, at + 100))}…）。` +
        "折叠判据与 rolldown 写下的形式不再匹配，client 产物的字节会随安装布局变化。",
    );
  }
  return collapsed;
}

/**
 * 包名同源校验的上下文：校验逻辑在各包（它知道自己哪几个源文件带着包名字面量），
 * 判断材料在这里。
 */
export interface ClientNameContext {
  /** package.json 的 name（外壳 里 id 的唯一来源）。 */
  readonly pkgName: string;
  /** 改写后的 chunk 正文（尚未包进 外壳）。 */
  readonly body: string;
  /** 读包根下一份源码文件。 */
  readonly readSource: (relative: string) => Promise<string>;
}

/** client 侧构建的完整配置。 */
export interface ClientBuildOptions {
  /** 包根绝对路径（调用方的 `import.meta.dirname`）。 */
  readonly root: string;
  /** 调用方注入的 rolldown。 */
  readonly rolldown: RolldownFactory;
  /**
   * 调用方注入的解析器（rolldown 的 `parseAst`）。**构建时必须提供**：产物里的
   * `require(...)` / `require.async(...)` 判据读 AST，不再扫文本。类型上暂为可选，
   * 只是为了让消费者在 shared 发布前仍能通过编译；运行时缺失会直接失败，
   * 不会退化成「少检查一项」的静默放行。
   */
  readonly parseAst?: ParseSourceAst;
  /** 客户端入口（相对包根）。缺省 `src/client-entry.ts`。 */
  readonly entry?: string;
  /** 产物首行的 GENERATED 头（不含换行）。它是产物字节的一部分，逐字由调用方给定。 */
  readonly header: string;
  /** 外置说明符全量清单（按包名边界匹配，逐项可以是子路径）。缺省 {@link REACT_RUNTIME_MODULES}。 */
  readonly externals?: readonly string[];
  /** 压缩产物。缺省不压。 */
  readonly minify?: boolean;
  /** 保留注释。缺省跟随 minify（压缩则只留法律注释，不压缩则全留）。 */
  readonly comments?: boolean;
  /** 包名同源校验。槽位 key、`$mount` 的 package 位之类各包自带的字面量声明在这里核对；
   * 缺省不校验。抛错即构建失败。 */
  readonly verifyName?: (context: ClientNameContext) => Promise<void> | void;
}

/** 下发给 rolldown `bundle.generate()` 的选项（客户端产物固定 CJS）。 */
export interface ClientGenerateOptions {
  /** 输出格式：客户端外壳只给 `require`，因此只能是 CJS。 */
  readonly format: "cjs";
  /** 压缩。缺省不压。 */
  readonly minify?: boolean;
  /** 注释保留策略；`false` 连法律注释一起抹掉。 */
  readonly comments?: boolean | CommentsOptions;
  /** 关掉打包器自己的代码分割（与包内 chunk 通道冲突，见 generateOptionsOf）。 */
  readonly codeSplitting?: boolean;
  /** 外部动态 import 不留在 CJS 里（外壳没有 `import()`）。 */
  readonly dynamicImportInCjs?: boolean;
}

/**
 * 一份包内按需 chunk 的声明：它自己的源文件与它在包内的产物名。
 *
 * 产物名由调用方给定、不按内容 hash 生成：入口源码里写的是
 * `require.async("./<fileName>")` 这条**字面**说明符（宿主按这串字算 chunkId），
 * 产物名若带 hash，入口就得被改写一遍才能对上，产物与源码不再逐字对应。
 */
export interface ClientChunkSpec {
  /** chunk 的源文件（相对包根），例如 `src/insights-charts.ts`。 */
  readonly source: string;
  /** 产物文件名，必须匹配宿主规则 `client.<name>.js`。 */
  readonly fileName: string;
}

/** 一份客户端产物：文件名 + 完整正文（含 ModuleLoader 外壳）。 */
export interface ClientArtifact {
  /** 落盘文件名：入口固定 `client.js`，chunk 是声明里的 `fileName`。 */
  readonly fileName: string;
  /** 完整产物正文。 */
  readonly text: string;
}

/** 入口产物的固定文件名：宿主按这个名把包挂进 boot 图。 */
const CLIENT_ENTRY_FILE = "client.js";
/** 宿主对包内 chunk 文件名的规则（与 client-modules 的 CLIENT_CHUNK 同形）。 */
const CLIENT_CHUNK_FILE = /^client\.[\da-z][\w.-]*\.js$/iu;
/** react 家族说明符的正则形状：两个包名 + 任意子路径。 */
const REACT_FAMILY = /^react(?:-dom)?(?:\/|$)/u;
/**
 * 压缩产物的注释档位：只留法律注释。
 *
 * 三档必须一起写：只给 `legal` 时 annotation 与 jsdoc 仍取缺省 true，产物会多出
 * `/* @__PURE__ *\/` 之类的注释，字节与旧的 `comments: false` 不再相同。
 */
const LEGAL_COMMENTS = { legal: true, annotation: false, jsdoc: false } as const;

/**
 * package.json 的 name（外壳 的 id 用）。必须立即失败：id 写进产物的模块表键，键对不上时宿主
 * 不报错、整张设置卡静默不渲染；留一个退化的回退只会让构建与新鲜度检查两端一起通过，缺陷直达
 * 运行时。
 * @param manifest - 解析后的 package.json
 * @returns 包名
 */
function clientBundleId(manifest: Record<string, unknown>): string {
  const nameKey = "name";
  const raw = manifest[nameKey];
  if (typeof raw !== "string" || raw === "") {
    throw new Error(
      "package.json 的 name 缺失或非字符串。client 产物的 id 必须等于 dsh client 模块表的键（bundle 包名）。",
    );
  }
  // id 那一行是手写源码而不是 JSON：放行 npm 允许的字符集，挡住引号/反斜杠/换行造成的
  // 产物语法错误，让下面的 JSON.stringify 只是补充手段而不是唯一保障。
  if (!NPM_PACKAGE_NAME.test(raw)) {
    throw new Error(`package.json 的 name ${JSON.stringify(raw)} 不符合 npm 包名字符集。`);
  }
  return raw;
}

/**
 * react 家族判据：`react` 与 `react-dom` 两个包名的全部子路径。
 * @param name - 包名段
 * @returns 是否属于 react 家族
 */
function isReactFamily(name: string): boolean {
  return name === "react" || name === "react-dom";
}

/**
 * 登记清单里的 react 家族说明符集合。`clientReactGuard` 与 `clientExternalPredicate`
 * 共用同一份登记口径，避免两处各写一遍 filter。
 * @param externals - 外置说明符全量清单
 * @returns react 家族中逐字登记的说明符
 */
function reactFamilyOf(externals: readonly string[]): Set<string> {
  return new Set(externals.filter((specifier) => isReactFamily(packageNameOf(specifier))));
}

/**
 * 未登记的 react 家族说明符的统一报错。构建守卫与自查视图必须给出同一句话：
 * 外置会得到宿主模块表里没有的键，内联会得到第二份 React。
 * @param id - 未登记的说明符
 * @returns 可直接抛出的错误
 */
function reactNotRegisteredError(id: string): Error {
  return new Error(
    `${id} 是 react 家族说明符但不在外置清单里。` +
      "外置会得到宿主模块表里没有的键（加载期报错），内联会得到第二份 React（hooks 静默失效）；" +
      "真要引入子路径，先把它加进外置清单并确认宿主模块表里有同名项。",
  );
}

/**
 * 客户端外置规则：登记过的项按 {@link externalPatternOf} 生成正则——裸包名按包名边界泛化
 * （`^pkg(/|$)`），带子路径的登记项精确匹配；react 家族由 {@link clientReactGuard} 单独接管。
 *
 * 四条约束一起决定了这个形状，每一条都有实测出处：
 * 1. **不能用函数形态**：rolldown 官方 `external` 文档的 warning 段写明函数形态每个模块回调一次
 *    JS、开销显著，建议非函数值。
 * 2. **不能用字符串项**：字符串是**全等**匹配（Rust 侧 `String` 走 `memmem::find`），写 `"pkg"`
 *    不命中 `pkg/sub`，于是子路径要么漏外置、要么得逐个枚举——漏外置的那一半会静默把依赖打进
 *    产物，与宿主的模块级状态裂成两份。
 * 3. **子路径登记项不能泛化**：宿主模块表按说明符全等查键。登记 `@scope/pkg/client` 之后若把
 *    整个包名泛化，`@scope/pkg/lib/record` 这类**没有登记**的子路径也会被外置，产物里就留下一条
 *    加载期必然 miss 的 require（三个仓实测各多出一条，直到它们的 import 改走登记过的入口）。
 * 4. **react 家族不能进这张数组**：正则在 `isResolved:false` 那次判定里先命中就不再问插件，
 *    未登记的 `react-dom/server` 会被**静默外置**成宿主模块表里没有的键（实测 hookCalls=[]）。
 *    所以 react 家族留给 resolveId 守卫，那里对未登记说明符是抛错而不是放行。
 *
 * 导出给各包的构建脚本复用与测试直接驱动，与构建走同一份判断。
 * @param externals - 外置说明符全量清单（react 家族会被剔除后交给守卫）
 * @returns rolldown 的 external 正则数组
 */
export function clientExternalPatterns(externals: readonly string[]): RegExp[] {
  const registered = new Set<string>();
  for (const specifier of externals) {
    if (!isReactFamily(packageNameOf(specifier))) {
      registered.add(specifier);
    }
  }
  return Array.from(registered, (specifier) => externalPatternOf(specifier));
}

/**
 * react 家族的 resolveId 守卫：登记的说明符外置，**没登记的当场构建失败**。
 *
 * 为什么既不悄悄内联也不按前缀放行：外壳注入的 require 只在宿主模块表里查键。按前缀放行会
 * 得到一条表里没有的 require（加载期 not in the module table，整张卡片不渲染也不给提示）；而
 * 悄悄内联会把 node_modules 里那份 React 打进产物、与宿主那份并存，页面里两个 React
 * 实例，hooks 直接报错。两种失败都不在构建期报错，所以这里没有可观察的中间态。
 *
 * `filter.id` 让 rolldown 只对 react 家族调这个钩子（官方文档：字符串形态在 resolveId 上不可用，
 * 正则按 `/` 归一后测），因此非 react 说明符一次都不会走到这里。
 * @param externals - 外置说明符全量清单（其中的 react 家族项即登记集）
 * @returns rolldown 插件
 */
export function clientReactGuard(externals: readonly string[]): Plugin {
  const registered = reactFamilyOf(externals);
  return {
    name: "dsh-react-family-guard",
    resolveId: {
      filter: { id: REACT_FAMILY },
      handler(id: string) {
        if (registered.has(id)) {
          return { id, external: true };
        }
        throw reactNotRegisteredError(id);
      },
    },
  };
}

/**
 * 判定视图：问「这条说明符能被构建接受为外置吗」。
 *
 * 构建自身**不再**用它（rolldown 收到的是正则数组 + resolveId 守卫，见
 * {@link clientExternalPatterns} 与 {@link clientReactGuard}）：函数形态每个模块回调一次 JS，
 * 官方文档点名开销显著。它保留给各包的构建脚本与测试做自查——「我登记的清单是不是恰好等于
 * 宿主模块表」这类断言需要逐条问同一份接受度，而不是复述一份。
 *
 * 语义与**接受度**严格一致，而不是与「外置规则」一致：外置规则按裸包名边界泛化，
 * `zod` 在清单里就会把 `zod/v4` 也外置；但宿主模块表按说明符全等查键，产物闸门
 * （assertRequireCalls）随后会让这条 require 的构建失败。自查视图若对这种
 * 子路径返回 true，调用方会以为它能用，实际构建红在另一个位置。所以这里只在**逐字登记**
 * 时返回 true；包名登记了、子路径没登记的情形与构建一样抛错。
 * react 家族同理：没登记就抛，不静默返回 false。
 * @param externals - 外置说明符全量清单
 * @returns 判定函数
 */
export function clientExternalPredicate(externals: readonly string[]): (id: string) => boolean {
  const registered = new Set(externals);
  const barePackages = new Set(
    externals.filter((specifier) => packageNameOf(specifier) === specifier),
  );
  const registeredReact = reactFamilyOf(externals);
  return (id: string) => {
    if (isReactFamily(packageNameOf(id))) {
      if (registeredReact.has(id)) {
        return true;
      }
      throw reactNotRegisteredError(id);
    }
    if (registered.has(id)) {
      return true;
    }
    const packageName = packageNameOf(id);
    if (packageName !== id && barePackages.has(packageName)) {
      throw new Error(
        `${id} 的包名 ${packageName} 在清单里，但这条子路径没有逐字登记。` +
          "构建会按包名边界把它外置，而宿主模块表按说明符全等查键，这一条在加载期必然 miss，" +
          "产物闸门因此会让构建失败。改法二选一：把这条子路径逐字加进清单并确认宿主模块表" +
          "有同名项，或改从登记过的入口说明符取值。",
      );
    }
    return false;
  };
}

/**
 * 读包根下一份源码文件，供包名同源校验用。
 * @param file - 绝对路径
 * @returns 文件正文
 */
async function readSourceFile(file: string): Promise<string> {
  return readFile(file, "utf8");
}

/**
 * 校验并索引 chunk 声明。
 *
 * 三道门都在构建期，因为它们在运行时全是静默的：产物名不合宿主规则 → 加载期 404；两个
 * chunk 撞名 → 后者覆盖前者，入口可能拿到另一份代码；文件名带 `client.node.` → 宿主明确
 * 不把这类文件当浏览器工厂脚本提供。
 * @param chunks - 调用方声明的 chunk
 * @returns 产物名到声明的映射
 */
function chunkSpecsOf(chunks: readonly ClientChunkSpec[]): ReadonlyMap<string, ClientChunkSpec> {
  const byFile = new Map<string, ClientChunkSpec>();
  for (const spec of chunks) {
    if (!CLIENT_CHUNK_FILE.test(spec.fileName)) {
      throw new Error(
        `chunk 产物名 ${JSON.stringify(spec.fileName)} 不匹配宿主的包内 chunk 规则` +
          "（client.<name>.js，且只含字母数字与 . _ -）。名字不合规则时宿主按 404 提供，" +
          "运行时表现是 require.async 悬挂或失败，构建期看不出来。",
      );
    }
    if (spec.fileName === "client.node.js" || spec.fileName.startsWith("client.node.")) {
      throw new Error(
        `chunk 产物名 ${JSON.stringify(spec.fileName)} 撞上 Node 客户端入口的保留名：` +
          "宿主不会把 client.node.* 当作浏览器工厂脚本提供。",
      );
    }
    if (byFile.has(spec.fileName)) {
      throw new Error(`chunk 产物名重复：${JSON.stringify(spec.fileName)} 被声明了两次。`);
    }
    byFile.set(spec.fileName, spec);
  }
  return byFile;
}

/**
 * 把一份 chunk 正文包进 ModuleLoader 外壳。入口与 chunk 的唯一差别是 chunk 多一个 `chunk:` 位。
 * @param pkgName - 包名（模块表键）
 * @param body - 已改写的 chunk 正文
 * @param chunkFile - chunk 产物名；入口传 undefined
 * @returns 完整产物正文
 */
function wrapClientArtifact(pkgName: string, body: string, chunkFile: string | undefined): string {
  // JSON.stringify 负责转义：id 是拼进源码的字面量，手写引号在包名含引号/反斜杠时
  // 会让整个产物语法错误。
  const registration = [
    `  id: ${JSON.stringify(pkgName)},`,
    ...(chunkFile === undefined ? [] : [`  chunk: ${JSON.stringify(chunkFile)},`]),
    "  factory: (require) => {",
    // 'use strict' 必须在指令序言里：外壳 的两条声明排在 chunk 之前，chunk 自带的
    // "use strict" 会被顶出序言，整份产物变成 sloppy 模式。
    "    'use strict';",
    "    const module = { exports: {} };",
    "    let exports = module.exports;",
    body,
    "    return module.exports;",
    "  },",
  ];
  return ["window.__ModuleLoader__.load({", ...registration, "});", ""].join("\n");
}

/** 编译后的正文与它里面的 require 调用（判据读 AST，不再扫文本）。 */
interface CompiledClientBody {
  readonly body: string;
  readonly requireCalls: RequireCallFacts;
}

/** 一份已编译的产物：外壳文本 + 判据要读的 require 调用。 */
interface BuiltClientArtifact {
  readonly artifact: ClientArtifact;
  readonly requireCalls: RequireCallFacts;
}

/**
 * 编译一份源文件为改写后的 chunk 正文（未包外壳）。
 * @param options - 构建配置
 * @param source - 相对包根的源文件
 * @param generateOptions - 下发给 rolldown 的 generate 选项
 * @returns 摊平路径后的正文与 require 调用
 */
async function compileClientBody(
  options: ClientBuildOptions,
  source: string,
  generateOptions: ClientGenerateOptions,
): Promise<CompiledClientBody> {
  const { parseAst } = options;
  if (parseAst === undefined) {
    throw new Error(
      `构建配置缺少 parseAst：${source} 的 require 调用与 require.async 引用无从核对` +
        "（构建未发生，不要当成成功）。调用方必须注入 rolldown/parseAst。",
    );
  }
  const externals = options.externals ?? REACT_RUNTIME_MODULES;
  const bundle = await options.rolldown({
    input: path.join(options.root, source),
    // 外置规则见 clientExternalPatterns 的三条约束；react 家族的守卫单独一个插件。
    external: clientExternalPatterns(externals),
    platform: "browser",
    // 模块横幅（`// <path>`）的相对路径由 rolldown 按 cwd 算出。cwd 缺省是 process.cwd()，
    // 于是同一份源码在包根/工作区别处构建出不同字节。固定成包根后产物与调用者的 cwd 无关。
    cwd: options.root,
    // 显式 extensions 是**替换**默认值而不是追加：默认含 .tsx/.jsx（实测），只列
    // .ts/.js/.json 会让导入 .tsx 组件的构建直接 UNRESOLVED_IMPORT。
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    },
    plugins: [clientReactGuard(externals)],
  });
  let body: string;
  try {
    const { output } = await bundle.generate(generateOptions);
    // 一份源文件必须产出恰好一个 entry chunk：多出来的 chunk 不会被写盘，运行时表现为缺模块。
    const chunk = singleEntryChunk(output, source);
    // 模块横幅按 rolldown 的 `cwd`（已固定成包根）算路径，与 process.cwd() 无关；不再做
    // 文本后处理。这里只折叠 pnpm store 段——那是安装布局差异，与路径基准是两件事。
    body = collapseStorePaths(chunk.code.trimEnd());
  } catch (error) {
    // bundle 持有原生资源，异常路径同样要释放；closeQuietly 保证释放失败不盖掉这里的错因。
    await closeQuietly(bundle);
    throw error;
  }
  // 成功路径不用 closeQuietly：那里 close 失败仍应判定失败，资源没释放是构建器的问题。
  await bundle.close();
  let requireCalls: RequireCallFacts;
  try {
    requireCalls = collectRequireCalls(parseAst(body, source));
  } catch (error) {
    throw new Error(`解析 ${source} 的 client 产物失败（require 判据）：${String(error)}`, {
      cause: error,
    });
  }
  return { body, requireCalls };
}

/**
 * 非字面调用必须拒绝：说明符在运行时才算出来，构建期无法核对宿主模块表的键。
 * @param fileName - 产物文件名
 * @param facts - 该产物里的 require 调用
 */
function assertNoDynamicRequire(fileName: string, facts: RequireCallFacts): void {
  if (facts.dynamicStaticCalls > 0) {
    throw new Error(
      `产物 ${fileName} 里有 ${facts.dynamicStaticCalls} 处非字面 require(...)：说明符要到运行时才能算出来，` +
        "构建期无法核对宿主模块表的键，命中不了时加载期不会给任何提示。改成字面说明符：" +
        '外置依赖写 require("<登记过的说明符>")，包内 chunk 写 require.async("./client.<name>.js")。',
    );
  }
  if (facts.dynamicAsyncCalls > 0) {
    throw new Error(
      `产物 ${fileName} 里有 ${facts.dynamicAsyncCalls} 处非字面 require.async(...)：构建期无法核对它指向的产物。` +
        '改成字面写法 require.async("./client.<name>.js")，并确认该产物已在 chunks 里声明。',
    );
  }
}

/**
 * 静态 require 的说明符必须落在外置登记表里；包内相对/绝对路径一律拒绝。
 * @param fileName - 产物文件名
 * @param facts - 该产物里的 require 调用
 * @param registered - 外置说明符全量清单（逐字）
 */
function assertStaticRequires(
  fileName: string,
  facts: RequireCallFacts,
  registered: readonly string[],
): void {
  for (const specifier of facts.staticSpecifiers) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      throw new Error(
        `产物 ${fileName} 里出现包内相对同步 require：${JSON.stringify(specifier)}。` +
          "宿主模块表只有包名键与经 require.async 加载的 chunk 键，没有相对路径这条边，" +
          '运行时一定 miss；包内 chunk 必须改用 require.async("./client.<name>.js")。',
      );
    }
  }
  const allowed = new Set(registered);
  for (const specifier of facts.staticSpecifiers) {
    if (!allowed.has(specifier)) {
      throw new Error(
        `产物 ${fileName} 里有未登记的外置 require：${JSON.stringify(specifier)}。` +
          `宿主模块表只按说明符全等查键（本包登记了 ${allowed.size} 条），这一条在加载期必然 miss，` +
          "而构建、类型检查与打包三步都不会报错。改法二选一：把这条依赖改成从登记过的入口说明符取" +
          "（客户端侧通常就是本包的 `/client` 子路径），或把它逐字加进外置清单并确认宿主模块表里有同名项。",
      );
    }
  }
}

/**
 * 单份产物里的 chunk 引用必须指向声明过并会构建的文件；引用了没构建的文件会在加载期 404。
 *
 * 「声明了没人引用」是跨产物的判断：入口可以只引用一部分 chunk，另一部分由别的 chunk 引用，
 * 所以那一半放在 {@link assertEveryChunkReferenced} 里按全集判。
 * @param fileName - 产物文件名
 * @param facts - 该产物里的 require 调用
 * @param chunkFiles - 本包声明的 chunk 产物名
 */
function assertChunkReferences(
  fileName: string,
  facts: RequireCallFacts,
  chunkFiles: ReadonlySet<string>,
): void {
  for (const specifier of new Set(facts.asyncSpecifiers)) {
    const expected = specifier.startsWith("./") ? specifier.slice(2) : "";
    if (!chunkFiles.has(expected)) {
      throw new Error(
        `产物 ${fileName} 里出现未声明的 chunk 引用：${JSON.stringify(specifier)}。` +
          "宿主只会提供声明过并真的构建出来的 chunk 产物；引用一个不存在的文件时加载期一定 miss，" +
          "而构建、类型检查与打包三步都不会报错。",
      );
    }
  }
}

/**
 * 每个声明的 chunk 都必须被某一产物按 `require.async("./<fileName>")` 引用过。
 *
 * 不查这一条的后果是「产物落盘但没人加载」：包体积白涨、用户看不到图表，而构建、类型、
 * 打包三步全绿——它们都不关心产物之间的引用关系。
 * @param referenced - 全部产物里出现过的 chunk 引用
 * @param chunkFiles - 本包声明的 chunk 产物名
 */
function assertEveryChunkReferenced(
  referenced: ReadonlySet<string>,
  chunkFiles: ReadonlySet<string>,
): void {
  for (const chunkFile of chunkFiles) {
    if (!referenced.has(`./${chunkFile}`)) {
      throw new Error(
        `chunk ${JSON.stringify(chunkFile)} 已声明但没有任何产物用 require.async("./${chunkFile}") 引用它。` +
          "声明与引用必须一致：漏了引用等于把代码打进包里却永远不加载。",
      );
    }
  }
}

/**
 * 产物里的 require 调用必须全部可核对。
 *
 * 四类命中都在构建期失败，因为它们在运行期都不给提示：非字面调用、包内相对同步边、
 * 未登记的外置说明符、chunk 引用与声明对不上。判据读 AST 而不是产物文本：正则字面量、
 * 注释与模板里也能出现 `require("x")` 的字符片段，按文本匹配会把它们当成真实调用
 * （误判）或漏掉变量形态（漏判）。
 * @param fileName - 产物文件名（报错点名用）
 * @param facts - 该产物里的 require 调用
 * @param registered - 外置说明符全量清单（逐字）
 * @param chunkFiles - 本包声明的 chunk 产物名
 */
function assertRequireCalls(
  fileName: string,
  facts: RequireCallFacts,
  registered: readonly string[],
  chunkFiles: ReadonlySet<string>,
): void {
  assertNoDynamicRequire(fileName, facts);
  assertStaticRequires(fileName, facts, registered);
  assertChunkReferences(fileName, facts, chunkFiles);
}

/**
 * 构造成员并包好外壳：编译正文 → 包名同源校验 → 外壳 拼装。
 * @param options - 构建配置
 * @param pkgName - 包名
 * @param fileName - 产物文件名
 * @param source - 相对包根的源文件
 * @param generateOptions - 下发给 rolldown 的 generate 选项
 * @returns 一份产物与它的 require 调用
 */
async function buildArtifact(
  options: ClientBuildOptions,
  pkgName: string,
  fileName: string,
  source: string,
  generateOptions: ClientGenerateOptions,
): Promise<BuiltClientArtifact> {
  const compiled = await compileClientBody(options, source, generateOptions);
  await options.verifyName?.({
    pkgName,
    body: compiled.body,
    readSource: (relative) => readSourceFile(path.join(options.root, relative)),
  });
  const shell = wrapClientArtifact(
    pkgName,
    compiled.body,
    fileName === CLIENT_ENTRY_FILE ? undefined : fileName,
  );
  return {
    artifact: { fileName, text: [options.header, shell].join("\n") },
    requireCalls: compiled.requireCalls,
  };
}

/**
 * 入口源文件（相对包根）。
 * @param options - 构建配置
 * @returns 相对路径
 */
function entrySource(options: ClientBuildOptions): string {
  return options.entry ?? path.join("src", "client-entry.ts");
}

/**
 * 下发给 rolldown 的 generate 选项。
 *
 * 三处显式取值都不是「省略就没事」，各有成因：
 * 1. **`codeSplitting: false`**：缺省下动态 import 会被拆成额外 chunk，入口用**同步** `require`
 *    引用它——宿主模块表没有那条边，运行期必 miss（见 assertRequireCalls）。本包的
 *    chunk 通道是 `require.async` + 每份产物独立构建，不需要打包器再拆。
 * 2. **`dynamicImportInCjs: false`**：外部动态 import 在 CJS 里会留成 `import(...)`，而外壳只给
 *    `require`。
 * 3. **`comments` 的对象形态**：`false` 会把法律注释一并抹掉，随包发布的第三方代码因此丢失许可
 *    头；`{ legal: true }` 只留 `/*!` 与 `@license` 那一类，压掉纯说明注释。实测这一形态与旧的
 *    `comments: false` 在 dsh-rtk / shared 两处客户端产物上**逐字节相同**（annotation/jsdoc 必须
 *    一起关，只留 legal 会多出若干 `@__PURE__` 标注字节）。
 *
 * 「不压缩时省略 comments 键」保持原样：rolldown 对「显式缺省值」与「省略键」不承诺逐字节
 * 同形，而各包的新鲜度检查逐字节比磁盘产物。
 * @param options - 构建配置
 * @returns generate 选项
 */
function generateOptionsOf(options: ClientBuildOptions): ClientGenerateOptions {
  const minify = options.minify ?? false;
  // 注释只有三态，且**显式值一律保持旧行为**（省略键 = rolldown 的缺省全留）：
  // - 显式 true：省略键，与改造前逐字节一致（压缩态也全留，那是调用方的明确要求）；
  // - 显式 false：整片抹掉；
  // - 未给：不压缩则全留（省略键），压缩则降到 legal-only——许可是必须随产物走的，
  //   而纯说明注释在压缩产物里没有装载价值。
  const { comments } = options;
  const base: ClientGenerateOptions = {
    format: "cjs",
    ...(minify ? { minify: true } : {}),
    codeSplitting: false,
    dynamicImportInCjs: false,
  };
  if (comments === false) {
    return { ...base, comments: false };
  }
  if (comments === undefined && minify) {
    return { ...base, comments: LEGAL_COMMENTS };
  }
  return base;
}

/**
 * 构建客户端产物：一个入口 + 若干包内按需 chunk。
 *
 * 入口与每个 chunk 各自一趟**独立**构建，而不是一趟多入口：多入口构建下 rolldown 会把共享
 * 模块拆成公共 chunk 并用同步 require 引用它，而宿主模块表没有那条边（见
 * {@link assertRequireCalls}）。独立构建的代价是公共依赖在每个 chunk 里各留一份——对
 * 「按需加载的大库」这个用途可以接受，换成运行时 miss 则不行。
 *
 * 调用方的源码用 `require.async("./client.<name>.js")` 引用 chunk：这个串是宿主
 * ClientBundleRequire.async 认的形态，rolldown 会原样保留（不解析成模块）。
 * @param options - {@link ClientBuildOptions} 加上 `chunks`
 * @returns 入口在首位，其后按声明顺序
 */
export async function buildClientArtifacts(
  options: ClientBuildOptions & { readonly chunks?: readonly ClientChunkSpec[] },
): Promise<readonly ClientArtifact[]> {
  const pkgName = clientBundleId(asRecord(await readManifest(options.root)));
  const specs = chunkSpecsOf(options.chunks ?? []);
  const generateOptions = generateOptionsOf(options);
  const sources: (readonly [string, string])[] = [
    [CLIENT_ENTRY_FILE, entrySource(options)],
    ...Array.from(specs.values(), (spec): readonly [string, string] => [
      spec.fileName,
      spec.source,
    ]),
  ];
  // 每份产物互相独立（各自一趟构建），并发即可；Promise.all 保序，返回值仍是
  // 「入口在首位，其后按声明顺序」。串行 await 在这里没有理由。
  const built = await Promise.all(
    sources.map(([fileName, source]) =>
      buildArtifact(options, pkgName, fileName, source, generateOptions),
    ),
  );
  const registered = options.externals ?? REACT_RUNTIME_MODULES;
  const chunkFiles = new Set(specs.keys());
  const referenced = new Set<string>();
  // 每份产物都按同一份 chunk 全集判：单份里的引用必须指向声明过的产物。
  for (const { artifact, requireCalls } of built) {
    for (const specifier of requireCalls.asyncSpecifiers) {
      referenced.add(specifier);
    }
    assertRequireCalls(artifact.fileName, requireCalls, registered, chunkFiles);
  }
  // 「声明了没人引用」跨产物判：入口不必自己引用每个 chunk，别的 chunk 也可以引用它。
  assertEveryChunkReferenced(referenced, chunkFiles);
  return built.map(({ artifact }) => artifact);
}

/**
 * 构建单文件客户端产物的完整文本（含 ModuleLoader 外壳）。等价于只构建入口。
 *
 * 没有声明 chunk：入口里任何 `require.async("./client.*.js")` 都会按「未声明」判红，
 * 因为这条构建路径不会产出那个文件。
 * @param options - 见 {@link ClientBuildOptions}
 * @returns 产物正文
 */
export async function buildClientBundle(options: ClientBuildOptions): Promise<string> {
  const pkgName = clientBundleId(asRecord(await readManifest(options.root)));
  const built = await buildArtifact(
    options,
    pkgName,
    CLIENT_ENTRY_FILE,
    entrySource(options),
    generateOptionsOf(options),
  );
  assertRequireCalls(
    built.artifact.fileName,
    built.requireCalls,
    options.externals ?? REACT_RUNTIME_MODULES,
    new Set<string>(),
  );
  return built.artifact.text;
}
