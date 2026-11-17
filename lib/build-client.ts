// lib/build-client.ts —— 插件包 client 侧产物的统一编排：rolldown 把客户端入口打包为
// CJS（react 家族精确外置），再包进 window.__ModuleLoader__.load({ id, factory }) 的 外壳 里。
// id 取 package.json 的 name，与 dsh.client 模块表键一致。
//
// 调用方（各包根的 build-client.mjs）声明入口、产物头与包名同源校验；外置规则、
// store 路径改写与 外壳 拼装都在这里。rolldown 由调用方注入（各包自己的 devDependency）。
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CommentsOptions, Plugin } from "rolldown";
import { canonicalizeRegionPaths } from "./canonicalize-region-paths.ts";
import {
  asRecord,
  closeQuietly,
  escapeRegExp,
  externalPatternOf,
  packageNameOf,
  readManifest,
  singleEntryChunk,
} from "./build-artifacts.ts";
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
 * 两种注释形态都要改写：workspace 软链安装下共享库模块标成 `//#region` 行；从 registry 安装时
 * （消费仓 CI 的 frozen 安装正是这个形状）同一批模块标成 `// node_modules/…` 横幅，路径里带
 * `.pnpm/<名>@<版>_<peer 后缀>` 那一层。只改前者时，后者的 store 段原样留在产物里，下面的
 * 兜底检查把整次构建判定失败——0.1.8 就是在这个形状上失败的，而工作区软链安装碰不到 `.pnpm`，
 * 所以本地检查与发布前的全部检查都看不见它。
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
/** 字面串的三种引号：产物是压缩代码，rolldown 用反引号包字符串。 */
const QUOTES: readonly string[] = ['"', "'", "`"];
/**
 * 三种引号合成的正则字符类。
 *
 * 不手写 `["'`]` 这类字面量：反引号在模板串里必须转义，而 String.raw 又会把那个转义
 * 原样留在正则源码里——`u` 旗标下 `\`` 是非法转义，整条判据在运行期抛 SyntaxError。
 * join 出来的字符类没有这一层歧义。
 */
const QUOTE_CHARS = QUOTES.join("");
/** 引号字符类（正则源码）。 */
const QUOTE_CLASS = `[${QUOTE_CHARS}]`;
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
  const registered = new Set(
    externals.filter((specifier) => isReactFamily(packageNameOf(specifier))),
  );
  return {
    name: "dsh-react-family-guard",
    resolveId: {
      filter: { id: REACT_FAMILY },
      handler(id: string) {
        if (registered.has(id)) {
          return { id, external: true };
        }
        throw new Error(
          `${id} 是 react 家族说明符但不在外置清单里。` +
            "外置会得到宿主模块表里没有的键（加载期报错），内联会得到第二份 React（hooks 静默失效）；" +
            "真要引入子路径，先把它加进外置清单并确认宿主模块表里有同名项。",
        );
      },
    },
  };
}

/**
 * 判定视图：问「这条说明符会被外置吗」。
 *
 * 构建自身**不再**用它（rolldown 收到的是正则数组 + resolveId 守卫，见
 * {@link clientExternalPatterns} 与 {@link clientReactGuard}）：函数形态每个模块回调一次 JS，
 * 官方文档点名开销显著。它保留给各包的构建脚本与测试做自查——「我登记的清单是不是恰好等于
 * 宿主模块表」这类断言需要逐条问同一份规则，而不是复述一份。
 *
 * 语义与构建严格一致：非 react 说明符按包名边界命中即外置；react 家族里没登记的**抛错**
 * （静默返回 false 会让调用方以为它会被内联，而构建实际会失败）。
 * @param externals - 外置说明符全量清单
 * @returns 判定函数
 */
export function clientExternalPredicate(externals: readonly string[]): (id: string) => boolean {
  const patterns = clientExternalPatterns(externals);
  const registeredReact = new Set(
    externals.filter((specifier) => isReactFamily(packageNameOf(specifier))),
  );
  return (id: string) => {
    if (isReactFamily(packageNameOf(id))) {
      if (registeredReact.has(id)) {
        return true;
      }
      throw new Error(
        `${id} 是 react 家族说明符但不在外置清单里。` +
          "外置会得到宿主模块表里没有的键（加载期报错），内联会得到第二份 React（hooks 静默失效）；" +
          "真要引入子路径，先把它加进外置清单并确认宿主模块表里有同名项。",
      );
    }
    return patterns.some((pattern) => pattern.test(id));
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

/**
 * 编译一份源文件为改写后的 chunk 正文（未包外壳）。
 * @param options - 构建配置
 * @param source - 相对包根的源文件
 * @param generateOptions - 下发给 rolldown 的 generate 选项
 * @returns 摊平路径后的正文
 */
async function compileClientBody(
  options: ClientBuildOptions,
  source: string,
  generateOptions: ClientGenerateOptions,
): Promise<string> {
  const externals = options.externals ?? REACT_RUNTIME_MODULES;
  const bundle = await options.rolldown({
    input: path.join(options.root, source),
    // 外置规则见 clientExternalPatterns 的三条约束；react 家族的守卫单独一个插件。
    external: clientExternalPatterns(externals),
    platform: "browser",
    // `//#region` 行的相对路径由 rolldown 按 cwd 算出。cwd 缺省是 process.cwd()，于是
    // 同一份源码在包根/工作区别处构建出不同字节。固定成包根后产物与调用者的 cwd 无关。
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
    // 改写 canonical 必须落在返回值之前：调用方的新鲜度检查逐字节比内存构建与磁盘产物，
    // 不能只在写盘这一步做。
    body = collapseStorePaths(
      canonicalizeRegionPaths(chunk.code.trimEnd(), options.root, process.cwd()),
    );
  } catch (error) {
    // bundle 持有原生资源，异常路径同样要释放；closeQuietly 保证释放失败不盖掉这里的错因。
    await closeQuietly(bundle);
    throw error;
  }
  // 成功路径不用 closeQuietly：那里 close 失败仍应判定失败，资源没释放是构建器的问题。
  await bundle.close();
  return body;
}

/**
 * 产物里 `require("<spec>")` 形态的字面说明符（不匹配 `require.async(...)`）。
 * @param code - 产物正文
 * @returns 说明符清单（按出现顺序，可能重复）
 */
function literalRequireSpecs(code: string): string[] {
  const pattern = new RegExp(
    String.raw`\brequire\(\s*${QUOTE_CLASS}([^${QUOTE_CHARS}]+)${QUOTE_CLASS}\s*\)`,
    "gu",
  );
  // 取捕获组用 String(match[1]) 而不是 `match[1] ?? ""`：这个组在正则里不是可选的，没有匹配
  // 却只缺这一组的输入，那个 `??` 分支永远走不到，留着只会让覆盖率门收一条假分支。
  return Array.from(code.matchAll(pattern), (match) => String(match[1]));
}

/**
 * 断言产物里的每一条外置 require 都是**逐字登记过**的说明符。
 *
 * 这是「按包名边界外置」那条规则的配套闸门，缺了它外置会静默变宽：`^pkg(/|$)` 命中
 * `pkg/lib/util` 之后产物里就留下一条 `require("pkg/lib/util")`，而宿主模块表按**说明符全等**
 * 查键——加载期 not in the module table，整张卡片不渲染，构建、类型、打包三步全绿。
 *
 * 两类命中都要拦：说明符不在清单里（清单外的包被顺手外置了），以及包名在清单里但子路径没登记
 * （正是上面那条静默变宽）。相对说明符不在这里判——包内边由 assertNoStaticChunkRequire 负责。
 * @param artifacts - 已构建产物
 * @param registered - 外置说明符全量清单（逐字）
 */
function assertRegisteredExternals(
  artifacts: readonly ClientArtifact[],
  registered: readonly string[],
): void {
  const allowed = new Set(registered);
  for (const artifact of artifacts) {
    for (const specifier of literalRequireSpecs(artifact.text)) {
      const isLocal = specifier.startsWith(".") || specifier.startsWith("/");
      if (!isLocal && !allowed.has(specifier)) {
        throw new Error(
          `产物 ${artifact.fileName} 里有未登记的外置 require：${JSON.stringify(specifier)}。` +
            `宿主模块表只按说明符全等查键（本包登记了 ${allowed.size} 条），这一条在加载期必然 miss，` +
            "而构建、类型检查与打包三步都不会报错。改法二选一：把这条依赖改成从登记过的入口说明符取" +
            "（客户端侧通常就是本包的 `/client` 子路径），或把它逐字加进外置清单并确认宿主模块表里有同名项。",
        );
      }
    }
  }
}

/**
 * 断言声明的每个 chunk 都真的被某份产物按 `require.async("./<fileName>")` 引用过。
 *
 * 不查这一条的后果是「产物落盘但没人加载」：包体积白涨、用户看不到图表，而构建、类型、
 * 打包三步全绿——它们都不关心产物之间的引用关系。
 * @param artifacts - 已构建产物
 * @param specs - 声明的 chunk
 */
function assertChunksReferenced(
  artifacts: readonly ClientArtifact[],
  specs: ReadonlyMap<string, ClientChunkSpec>,
): void {
  for (const fileName of specs.keys()) {
    // String.raw 让正则源码逐字可读：这里的反斜杠不是转义，是正则自己的语法。
    const spec = new RegExp(
      String.raw`require\.async\(\s*${QUOTE_CLASS}\./${escapeRegExp(fileName)}${QUOTE_CLASS}\s*\)`,
      "u",
    );
    if (!artifacts.some((artifact) => spec.test(artifact.text))) {
      throw new Error(
        `chunk ${JSON.stringify(fileName)} 已声明但没有任何产物用 require.async("./${fileName}") 引用它。` +
          "声明与引用必须一致：漏了引用等于把代码打进包里却永远不加载。",
      );
    }
  }
}

/**
 * 断言产物里没有跨 chunk 的**同步** require。
 *
 * 宿主模块表里只有「包本身」与「经 require.async 加载的 chunk」两类键，没有
 * `require("./client.x.js")` 这种包内相对同步边；它会在运行期 miss，而产物语法合法，
 * 构建与打包都察觉不到。
 * @param artifacts - 已构建产物
 */
function assertNoStaticChunkRequire(artifacts: readonly ClientArtifact[]): void {
  const staticChunkRequire = new RegExp(
    String.raw`require\(\s*${QUOTE_CLASS}\./client\.[^${QUOTE_CHARS}]*\.js${QUOTE_CLASS}\s*\)`,
    "u",
  );
  for (const artifact of artifacts) {
    const hit = staticChunkRequire.exec(artifact.text);
    if (hit !== null) {
      throw new Error(
        `产物 ${artifact.fileName} 里出现跨 chunk 的同步 require：${JSON.stringify(hit[0])}。` +
          "宿主模块表没有这条边，运行时一定 miss；请改用 require.async。",
      );
    }
  }
}

/**
 * 构造成员并包好外壳：编译正文 → 包名同源校验 → 外壳 拼装。
 * @param options - 构建配置
 * @param pkgName - 包名
 * @param fileName - 产物文件名
 * @param source - 相对包根的源文件
 * @param generateOptions - 下发给 rolldown 的 generate 选项
 * @returns 一份产物
 */
async function buildArtifact(
  options: ClientBuildOptions,
  pkgName: string,
  fileName: string,
  source: string,
  generateOptions: ClientGenerateOptions,
): Promise<ClientArtifact> {
  const body = await compileClientBody(options, source, generateOptions);
  await options.verifyName?.({
    pkgName,
    body,
    readSource: (relative) => readSourceFile(path.join(options.root, relative)),
  });
  const shell = wrapClientArtifact(
    pkgName,
    body,
    fileName === CLIENT_ENTRY_FILE ? undefined : fileName,
  );
  return { fileName, text: [options.header, shell].join("\n") };
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
 *    引用它——宿主模块表没有那条边，运行期必 miss（见 assertNoStaticChunkRequire）。本包的
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
 * assertNoStaticChunkRequire）。独立构建的代价是公共依赖在每个 chunk 里各留一份——对
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
  const artifacts = await Promise.all(
    sources.map(([fileName, source]) =>
      buildArtifact(options, pkgName, fileName, source, generateOptions),
    ),
  );
  // 先判同步 require：它比「漏了引用」更根本——产物之间有静态边时，即使入口也写了
  // require.async，运行时仍会先在这条边 miss。
  assertNoStaticChunkRequire(artifacts);
  assertChunksReferenced(artifacts, specs);
  assertRegisteredExternals(artifacts, options.externals ?? REACT_RUNTIME_MODULES);
  return artifacts;
}

/**
 * 构建单文件客户端产物的完整文本（含 ModuleLoader 外壳）。等价于只构建入口。
 * @param options - 见 {@link ClientBuildOptions}
 * @returns 产物正文
 */
export async function buildClientBundle(options: ClientBuildOptions): Promise<string> {
  const pkgName = clientBundleId(asRecord(await readManifest(options.root)));
  const artifact = await buildArtifact(
    options,
    pkgName,
    CLIENT_ENTRY_FILE,
    entrySource(options),
    generateOptionsOf(options),
  );
  assertRegisteredExternals([artifact], options.externals ?? REACT_RUNTIME_MODULES);
  return artifact.text;
}
