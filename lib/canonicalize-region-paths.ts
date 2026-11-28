// lib/canonicalize-region-paths.ts —— 构建期产物规范化：把 rolldown 写进产物的
// 模块路径横幅改写成与调用方 cwd 无关的形态。
//
// 为什么存在：rolldown 的模块横幅路径按**它的 `cwd` 选项**算（官方源码
// `crates/rolldown_common/src/types/resolved_id.rs` 的 `debug_id`：relative to the cwd；
// `crates/rolldown/src/module_loader/module_task.rs` 传入的是 `ctx.options.cwd`），
// `cwd` 缺省又是 `process.cwd()`（`packages/rolldown/src/options/input-options.ts`）。
// 同一份源码于是有多种字节：
//   cwd = 包根（`npm run build` / vitest 的形态）→ `// lib/failure-classify.ts`
//   cwd = plugins/                              → `// <包名>/lib/failure-classify.ts`
//   cwd = DSH_HOME（`node plugins/<包>/build-host.mjs`）→ `// plugins/<包名>/lib/…`
//   跨包依赖同理：`// ../shared/lib/record.ts` / `// shared/lib/record.ts`
//     / `// plugins/shared/lib/record.ts`
//
// 真正的根治点在 bundler 一侧：共享构建编排（lib/build-host.ts / lib/build-client.ts）
// 已把 rolldown 的 `cwd` 固定成包根，因此模块横幅本来就是包根相对、与
// `process.cwd()` 无关。**内部构建不再调用本函数**——文本后处理对生成代码是额外风险
// （字符串字面量里同形行会被改写），而固定基准已经消除了漂移的来源。
//
// 本函数保留为公开子路径，供无法控制 rolldown `cwd` 的外部构建脚本做一次性后处理。
// 它按显式基准解析路径，不再按段名猜测：
//   - `baseDir` 是**标记路径的基准**，应与 rolldown 的 `cwd` 同值（通常是包根或工作区根）；
//   - 把 raw 路径解析成绝对段串，再按完整路径段判断归属：落在包根下 → 相对包根输出；
//     落在包根父目录下 → 相对父目录输出（保留依赖包名）；
//   - 两者都判不出的路径**原样保留**，不再靠剥前缀把包外路径折成包内路径。
//
// 路径解析直接用 `node:path` 的 `win32` / `posix` 两套实现：它们是纯函数，不读盘、
// 不依赖调用方平台；POSIX / Windows / UNC 的 normalize、resolve、relative、dirname、
// isAbsolute 语义不需要在本模块重写一遍。根的选择按路径形态决定，跨根（不同盘符、
// 不同 UNC share、POSIX 与 Windows 混写）判不出归属时按原样保留。
//
// 生效范围与边界：
//   - 支持两种真实横幅：生产构建的 `// <path>`（见
//     `crates/rolldown/src/utils/render_ecma_module.rs`）与 HMR 载荷的
//     `//#region <path>` / `//#endregion`（见 `crates/rolldown/src/hmr/hmr_stage.rs`）。
//     `//#endregion` 不改写。
//   - `pkgDir` 与 `baseDir` 必须是绝对路径；解析不出根时整份文本原样交回。
//   - 本函数**只对 rolldown 的原始产物处理一次**，不承诺幂等：canonical 文本不携带参照系，
//     `foo/a.ts` 在父目录基准下既可能指 `<包根>/foo/a.ts`，也可能指 `<父目录>/foo/a.ts`；
//     纯字符串无法区分。重复调用需要调用方自己带元数据，或改回“基准由 bundler 固定”的路线。
//   - 纯字符串分析无法区分注释与字符串内容：以 `// ` 或 `//#region ` 起行、且逐字符
//     同形于“标记 + 路径”的模板字面量内容仍会被改写。内部构建不调用本函数，因此不承担
//     这条风险；外部调用方应只对**生成代码**使用，不要对可能含用户数据的文本使用。
//
// 只在公开子路径里：它是构建脚本用的纯字符串函数，不是插件运行时 API；进了
// `lib/index.ts` 就会让每个运行期消费方都为它多一次导入。build-host.mjs 因此把它
// 单独列进 `entries`（不进 `facets` 数组——那数组是 barrel 的成员表），产出一个独立入口。
//
// ⚠ 它**确实在 `package.json` 的 `exports` 里**（`./lib/canonicalize-region-paths`）。
// 删掉那条 exports 会打断外部按子路径取用的构建脚本，所以「不进出 exports」那句是
// 错的，照着它做会出事；test/publish-manifest.test.ts 固定着这条一致性。

import path from "node:path";

/** 行首两种真实横幅；`//#endregion` 与代码里的其它行不在此列。 */
const MARKER_LINE = /^(?:\/\/#region |\/\/ ).*$/gmu;

/** 生产构建的模块横幅前缀。 */
const MODULE_MARK = "// ";

/** HMR 载荷的模块横幅前缀。 */
const REGION_MARK = "//#region ";

/** 标记之后必须长得像一段模块路径：非空、无空白、无引号、无反引号。 */
const MARKER_PATH_SHAPE = /^[^\s'"`]+$/u;

/** Windows 盘符绝对路径：盘符后必须跟分隔符；`C:foo` 是盘符相对，不按绝对路径算。 */
const WINDOWS_DRIVE = /^[A-Za-z]:[/\\]/u;

/** UNC 共享根的两段形状（统一成分隔符后）：`//server/share`。 */
const UNC_SHARE = /^\/\/[^/]+\/[^/]+/u;

/** `node:path` 的两套平台实现；二者 API 同形，只按路径根选一套。 */
type PathFlavor = typeof path.posix;

/** 一条已解析的绝对路径与它所属的平台语义。 */
interface ResolvedPath {
  /** 规范化后的绝对路径。 */
  readonly value: string;
  /** 该路径使用的平台语义。 */
  readonly flavor: PathFlavor;
}

/**
 * UNC 共享根的形状校验：`\\server\share`（统一成 `/` 后是 `//server/share`）。
 * `\\server` 只有 server 没有 share，不是可解析的根。
 * @param raw - 原始路径
 * @returns 是否具备 server/share 两段
 */
function hasUncShare(raw: string): boolean {
  return UNC_SHARE.test(raw.replaceAll("\\", "/"));
}

/**
 * 把绝对路径解析成「值 + 平台语义」。非绝对路径返回 null，由调用方原样交回。
 * @param raw - 原始绝对路径
 * @returns 解析结果；不是可识别的绝对路径时为 null
 */
function resolveAbsolute(raw: string): ResolvedPath | null {
  const unified = raw.replaceAll("\\", "/");
  if (unified.startsWith("//")) {
    return hasUncShare(raw) ? { value: path.win32.resolve(raw), flavor: path.win32 } : null;
  }
  if (WINDOWS_DRIVE.test(unified)) {
    return { value: path.win32.resolve(raw), flavor: path.win32 };
  }
  if (unified.startsWith("/")) {
    return { value: path.posix.resolve(raw), flavor: path.posix };
  }
  return null;
}

/**
 * 把横幅里的 raw 路径解析成绝对目标：绝对路径直接用，相对路径接到基准上。
 * @param raw - 横幅里的原始路径
 * @param base - 标记路径的基准
 * @returns 绝对目标；无效 UNC 或其它无法解析的形态为 null
 */
function targetOf(raw: string, base: ResolvedPath): ResolvedPath | null {
  const absolute = resolveAbsolute(raw);
  if (absolute !== null) {
    return absolute;
  }
  // 无效 UNC 也走这里：它不能被当成相对路径接在 base 上。
  if (raw.replaceAll("\\", "/").startsWith("//")) {
    return null;
  }
  const relative =
    base.flavor === path.posix ? raw.replaceAll("\\", "/") : raw.replaceAll("/", "\\");
  return { value: base.flavor.resolve(base.value, relative), flavor: base.flavor };
}

/**
 * `to` 相对 `from` 的路径；不在 `from` 之下（或不同平台根）时交回 null。
 * 判据是 `path.relative` 的完整路径段结果，不是字符串前缀。
 * @param from - 作为基准的绝对路径
 * @param to - 目标绝对路径
 * @returns 相对路径（`/` 分隔）；不隶属时为 null
 */
function relativeWithin(from: ResolvedPath, to: ResolvedPath): string | null {
  if (from.flavor !== to.flavor) {
    return null;
  }
  const relative = from.flavor.relative(from.value, to.value);
  if (relative === "") {
    return "";
  }
  if (from.flavor.isAbsolute(relative)) {
    return null;
  }
  const parts = relative.split(from.flavor.sep);
  if (parts[0] === "..") {
    return null;
  }
  return parts.join("/");
}

/**
 * 把一段标记路径改写成 canonical 形态。
 * @param rawPath - 标记里的原始路径
 * @param pkg - 包根
 * @param base - 标记路径的基准
 * @returns canonical 路径；判不出归属时原样交回
 */
function canonicalPathOf(rawPath: string, pkg: ResolvedPath, base: ResolvedPath): string {
  const target = targetOf(rawPath, base);
  if (target === null) {
    return rawPath;
  }
  const own = relativeWithin(pkg, target);
  if (own !== null) {
    return own === "" ? rawPath : own;
  }
  const parentValue = pkg.flavor.dirname(pkg.value);
  if (parentValue !== pkg.value) {
    const sibling = relativeWithin({ value: parentValue, flavor: pkg.flavor }, target);
    if (sibling !== null) {
      return sibling === "" ? rawPath : sibling;
    }
  }
  return rawPath;
}

/**
 * 改写单行。调用方已用 {@link MARKER_LINE} 预筛出行首横幅。
 * @param line - 以 `//#region ` 或 `// ` 开头的一行
 * @param pkg - 包根
 * @param base - 标记路径的基准
 * @returns canonical 形态的那一行
 */
function canonicalizeLine(line: string, pkg: ResolvedPath, base: ResolvedPath): string {
  const prefix = line.startsWith(MODULE_MARK) ? MODULE_MARK : REGION_MARK;
  const rawPath = line.slice(prefix.length);
  if (!MARKER_PATH_SHAPE.test(rawPath)) {
    return line;
  }
  return `${prefix}${canonicalPathOf(rawPath, pkg, base)}`;
}

/**
 * 产物文本的 canonical 形态：所有模块横幅行改写成与调用方 cwd 无关的形态，其余字节原样保留。
 * @param code - builder 拿到的产物文本
 * @param pkgDir - 包根绝对路径（builder 的 import.meta.dirname）
 * @param baseDir - 标记路径的基准，应与 rolldown 的 `cwd` 同值；省略时按包根
 * @returns 改写过模块横幅的同一份文本；无法解析根时原样交回
 */
export function canonicalizeRegionPaths(
  code: string,
  pkgDir: string,
  baseDir: string = pkgDir,
): string {
  const pkg = resolveAbsolute(pkgDir);
  const base = resolveAbsolute(baseDir);
  if (pkg === null || base === null) {
    return code;
  }
  return code.replaceAll(MARKER_LINE, (line) => canonicalizeLine(line, pkg, base));
}
