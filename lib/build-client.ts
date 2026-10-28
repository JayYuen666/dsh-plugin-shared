// lib/build-client.ts —— 插件包 client 侧产物的统一编排：rolldown 把客户端入口打包为
// CJS（react 家族精确外置），再包进 window.__ModuleLoader__.load({ id, factory }) 外壳。
// id 取 package.json 的 name，与 dsh.client 模块表键一致。
//
// 调用方（各包根的 build-client.mjs）声明入口、产物头与包名同源校验；外置规则、
// store 路径改写与外壳拼装都在这里。rolldown 由调用方注入（各包自己的 devDependency）。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeRegionPaths } from "./canonicalize-region-paths.ts";
import {
  asRecord,
  closeQuietly,
  packageNameOf,
  readManifest,
  singleEntryChunk,
} from "./build-artifacts.ts";
import type { RolldownFactory } from "./build-artifacts.ts";

/**
 * 宿主 seed 表里 react 家族的全部说明符（客户端产物只外置宿主真给得出的模块）。
 * 与宿主客户端自己的模块表同源：那张表里 react 家族只有这四条。外置清单更大的包
 * （宿主外壳基座扩容后）由调用方在 `externals` 里给全量清单。
 */
export const REACT_RUNTIME_MODULES: readonly string[] = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
];

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
      .replace(
        /^\/\/(?:#region | )?(?:(?:\.\.?\/)+)?node_modules\/\.pnpm\/[^/]+\/node_modules\//u,
        (matched) =>
          matched.startsWith("//#region") ? "//#region node_modules/" : "// node_modules/",
      ),
  );
  const leftover = /node_modules\/\.pnpm\//u.exec(collapsed);
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
  /** package.json 的 name（外壳 id 的唯一来源）。 */
  readonly pkgName: string;
  /** 改写后的 chunk 正文（未包外壳）。 */
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
  /** 外置说明符全量清单（精确匹配）。缺省 {@link REACT_RUNTIME_MODULES}。 */
  readonly externals?: readonly string[];
  /** 压缩产物。缺省不压。 */
  readonly minify?: boolean;
  /** 保留注释。缺省跟随 minify（压缩则移除，不压缩则保留）。 */
  readonly comments?: boolean;
  /** 包名同源校验。槽位 key、`$mount` 的 package 位之类各包自带的字面量声明在这里核对；
   * 缺省不校验。抛错即构建失败。 */
  readonly verifyName?: (context: ClientNameContext) => Promise<void> | void;
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
 * package.json 的 name（外壳 id 用）。必须立即失败：id 写进产物的模块表键，键对不上时宿主
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
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u.test(raw)) {
    throw new Error(`package.json 的 name ${JSON.stringify(raw)} 不符合 npm 包名字符集。`);
  }
  return raw;
}

/**
 * 客户端外置规则：登记过的精确说明符外置，react 家族里**没登记**的说明符当场失败。
 *
 * 为什么既不静默内联也不前缀放行：外壳注入的 require 只在宿主模块表里查键。前缀放行会
 * 得到一条表里没有的 require（加载期 not in the module table，整张卡片静默不渲染）；而
 * 静默内联会把 node_modules 里那份 React 打进产物、与宿主那份并存，页面里两个 React
 * 实例， hooks 直接报错。两种失败都不在构建期报错，所以这里没有可观察的中间态。
 * 导出给各包的构建脚本复用与测试直接驱动，与构建走同一份判断。
 * @param externals - 外置说明符全量清单（精确匹配）
 * @returns rolldown 的 external 判定函数
 */
export function clientExternalPredicate(externals: readonly string[]): (id: string) => boolean {
  const registered = new Set(externals);
  return (id: string) => {
    if (registered.has(id)) {
      return true;
    }
    const packageName = packageNameOf(id);
    if (packageName === "react" || packageName === "react-dom") {
      throw new Error(
        `${id} 是 react 家族说明符但不在外置清单里。` +
          "外置会得到宿主模块表里没有的键（加载期报错），内联会得到第二份 React（hooks 静默失效）；" +
          "真要引入子路径，先把它加进外置清单并确认宿主模块表里有同名项。",
      );
    }
    return false;
  };
}

/**
 * 构建客户端产物的完整文本（含 ModuleLoader 外壳）。
 * @param options - 见 {@link ClientBuildOptions}
 * @returns 产物正文
 */
export async function buildClientBundle(options: ClientBuildOptions): Promise<string> {
  const pkgName = clientBundleId(asRecord(await readManifest(options.root)));
  const entry = options.entry ?? path.join("src", "client-entry.ts");
  const minify = options.minify ?? false;
  const comments = options.comments ?? !minify;
  // 只在偏离缺省时下发这两个键：与「省略键」的旧调用形状逐字节一致（理由见 build-host）。
  const generateOptions = {
    format: "cjs",
    ...(minify ? { minify: true } : {}),
    ...(comments ? {} : { comments: false }),
  } as const;
  const bundle = await options.rolldown({
    input: path.join(options.root, entry),
    // 外置规则见 clientExternalPredicate 的说明：精确清单 + react 家族未登记即失败。
    external: clientExternalPredicate(options.externals ?? REACT_RUNTIME_MODULES),
    platform: "browser",
    // `//#region` 行的相对路径由 rolldown 按 cwd 算出。cwd 缺省是 process.cwd()，于是
    // 同一份源码在包根/工作区别处构建出不同字节。固定成包根后产物与调用者的 cwd 无关。
    cwd: options.root,
    // 显式 extensions 是**替换**默认值而不是追加：默认含 .tsx/.jsx（实测），只列
    // .ts/.js/.json 会让导入 .tsx 组件的构建直接 UNRESOLVED_IMPORT。
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    },
  });
  let body: string;
  try {
    const { output } = await bundle.generate(generateOptions);
    // CJS 外壳只包一块：多余 chunk / asset 不写入磁盘，产物要到运行时才因缺模块而报错。
    const chunk = singleEntryChunk(output, entry);
    // 改写 canonical 必须落在返回值之前：调用方的新鲜度检查逐字节比内存构建与磁盘产物，
    // 不能只在写入磁盘那一侧做。
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
  await options.verifyName?.({
    pkgName,
    body,
    readSource: (relative) => readSourceFile(path.join(options.root, relative)),
  });
  return [
    options.header,
    "window.__ModuleLoader__.load({",
    // JSON.stringify 负责转义：id 是拼进源码的字面量，手写引号在包名含引号/反斜杠时
    // 会让整个产物语法错误。
    `  id: ${JSON.stringify(pkgName)},`,
    "  factory: (require) => {",
    // 'use strict' 必须在指令序言里：外壳的两条声明排在 chunk 之前，chunk 自带的
    // "use strict" 会被顶出序言，整份产物变成 sloppy 模式。
    "    'use strict';",
    "    const module = { exports: {} };",
    "    let exports = module.exports;",
    body,
    "    return module.exports;",
    "  },",
    "});",
    "",
  ].join("\n");
}
