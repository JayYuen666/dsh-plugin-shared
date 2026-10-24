// lib/canonicalize-region-paths.ts —— 构建期产物正典化：把 rolldown 写进产物的
// `//#region <模块路径>` 标记折成与 process.cwd() 无关的形状。
//
// 为什么存在（实测的可复现性缺陷）：rolldown 给每个模块写的 `//#region` 标记，路径是
// **相对 process.cwd()** 的。同一份源码于是有多种字节：
//   cwd = 包根（`npm run build` / vitest 的形态）→ `//#region lib/failure-classify.ts`
//   cwd = plugins/                              → `//#region <包名>/lib/failure-classify.ts`
//   cwd = DSH_HOME（`node plugins/<包>/build-host.mjs`）→ `//#region plugins/<包名>/lib/…`
//   跨包依赖同理：`//#region ../shared/lib/record.ts` / `//#region shared/lib/record.ts`
//     / `//#region plugins/shared/lib/record.ts`
// 各包 test/host-freshness.ts / test/client-freshness.ts 是「磁盘产物 vs 内存构建」的逐字节
// 门，形态一漂移，门就把没改过的产物判成过期。修法只能在 builder 侧：产出 canonical 形态，
// 门两侧从此同形。
//
// 折法按调用形态分两档：
//   - 传入 cwd（builder 应传 process.cwd()）：先收掉行首的相对段（`./` 与 `../` 的任意串），
//     再按两枚**算出来的真前缀**依次整段收——`rel(cwd, 包根)`（自有模块）与
//     `rel(cwd, 包根父目录)`（同级依赖）。前缀是精确路径不是段名猜测，因此「包内目录恰好与
//     父目录或包名同名」不会再被误折，跨 cwd 同形与幂等对这类形态也成立。
//     残余局限：包内目录与**包名**同名、且 cwd 恰为包根父目录时，自有模块的 canonical 文本
//     （`<包名>/…`）与 raw 形态逐字相同，重入会多剥一层——纯字符串无法区分两者，无损修法
//     不存在，已记录在案。
//   - 不传 cwd（旧签名，兼容既有调用方）：按两枚锚点**段名**收——「包根的父目录名」与
//     「包名」，只按整段匹配。整段匹配是必需的：`@jayyuen66/dsh-plugin-shared` 把 `shared`
//     当子串，若按子串折，shared 自己的产物会把 node_modules 路径误折成 `lib/index.js`。
//     这档按名猜测，不保证「包内目录与锚点同名」形态的正确性，新调用方一律传 cwd。
//
// 只在 builder 侧调用，且**刻意不进 barrel**：它是构建脚本用的纯字符串函数，不是插件运行时
// API；进了 `lib/index.ts` 就会让每个运行期消费方都为它付一次导入。build-host.mjs 因此把它
// 单独列进 `entries`（不进 `facets` 数组——那数组是 barrel 的成员表），产出一个独立入口。
//
// ⚠ 它**确实在 `package.json` 的 `exports` 里**（`./lib/canonicalize-region-paths`），而且这条
// 是承重的：各兄弟包的 `build-*.mjs` 正是靠它按包子路径引本函数（quality-gate / ocr-review /
// session-rescue / dir-prep-organize / zvec-grep / danger-guard / lesson-loop / scrapling，
// 各一对 build-host 与 build-client）。只有本包自己的 builder 用相对说明符
// `./lib/canonicalize-region-paths.ts`（它们在包内，不需要绕子路径）。
// 删掉那条 exports = 一次性打断所有依赖它的包的构建，所以「不进出 exports」那句是
// 错的，照着它做会出事；test/publish-manifest.test.ts 钉着这条 parity。
//
// 纯字符串：不起子进程、不读盘、不 import node:path —— 包根与 cwd 由调用方（builder 里已有的
// import.meta.dirname 与 process.cwd()）作为字符串交进来，本模块只做行内文本重写。因此可单测，
// 也能在同一进程里对两侧（内存构建 / 磁盘产物）反复调用而不引入新的环境依赖。

/** rolldown 模块标记的前缀。`//#endregion` 与代码里的任何其它行都不在本函数的射程内。 */
const REGION_MARK = "//#region ";

/**
 * 整份产物里所有 `//#region ` 行的匹配：`^` 加 `m` 把判据钉在行首，只取标记本身到行尾。
 * 与逐行 `startsWith` + `slice` 等价，但一趟扫完，不为整份产物造中间数组。
 * 行首锚点只挡得住**单行**字符串字面量；跨行模板字面量里以标记起行的内容由
 * {@link REGION_PATH_SHAPE} 的形状判据再拦一层（残余局限见下）。
 */
const REGION_LINE = /^\/\/#region .*$/gmu;

/**
 * 标记之后必须长得像一段模块路径：非空、无空白、无引号、无反引号。rolldown 写的标记
 * 永远满足（模块路径不含这些字符）；模板字面量里以标记起行的自然语言内容带着空白，
 * 会被这条挡下、原样保留。残余局限：字面量内容若**逐字符**同形于「标记 + 路径」，纯字符串
 * 分析无从与真标记区分，仍会被改写——已钉在 test/canonicalize-region-paths.test.ts。
 */
const REGION_PATH_SHAPE = /^[^\s'"`]+$/u;

/**
 * 路径行首的相对段（`./` 与 `../` 的任意串），收掉后跨包依赖在两处 cwd 下才同形。
 * 相对段的**层级深度在此有意丢失**：`../x/y`（pkg cwd 的产物）与 `x/y`（父目录 cwd 的
 * 产物）必须折成同一个标记，这是跨 cwd 字节相等的承重判据，因此不能把 `../` 的层数编码
 * 进标记去保留可区分性；两个不同深度、同末段路径的模块折成同一标记，接受为已知局限。
 */
const LEADING_RELATIVE_SEGMENTS = /^(?:\.\.?\/)+/u;

/** 分隔符两头认：产物里的模块路径由 rolldown 写成 `/`，而 `import.meta.dirname` 在 Windows 上是 `\`。 */
const SEGMENT_SPLIT = /[/\\]+/u;

/**
 * 取路径的末段。
 * @param dir - 目录路径
 * @returns 末段；只剩分隔符时为空串
 */
function lastSegment(dir: string): string {
  const trimmed = dir.replace(/[/\\]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/**
 * 包根的父目录。先收掉尾随分隔符再取父，尾随分隔符才不会把父目录算错。
 * @param pkgDir - 包根路径
 * @returns 父目录；没有父目录（裸名、只剩分隔符）时原样或空串交回
 */
function parentDirOf(pkgDir: string): string {
  const trimmed = pkgDir.replace(/[/\\]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(0, index);
}

/**
 * 行首可被收掉的两枚锚点段（旧签名的按名猜测档）：包根的父目录名与包名。
 * @param pkgDir - 包根路径（调用方的 import.meta.dirname）
 * @returns 按序待收的段名；空串（pkgDir 只剩分隔符、或压根没有父目录）已剔除
 */
function leadingAnchors(pkgDir: string): string[] {
  const pkgName = lastSegment(pkgDir);
  const parent = parentDirOf(pkgDir);
  return [lastSegment(parent), pkgName].filter((anchor) => anchor.length > 0);
}

/**
 * 依次收掉行首的锚点段（每枚最多一次，且只在整段命中时收）。
 * @param path - 已收掉行首相对段的模块路径
 * @param anchors - 见 {@link leadingAnchors}
 * @returns 相对包根的形状；没有命中时段不变
 */
function stripLeadingAnchor(path: string, anchors: string[]): string {
  let rest = path;
  for (const anchor of anchors) {
    if (rest.startsWith(`${anchor}/`)) {
      rest = rest.slice(anchor.length + 1);
    }
  }
  return rest;
}

/**
 * 路径切段。POSIX 根的行首空段是「绝对」的记号，要保留；尾随分隔符产生的空段由
 * {@link trimTrailingEmptySegments} 收掉。
 */
/** 路径切段。分隔符两头认：产物里的模块路径由 rolldown 写成 `/`，Windows 的绝对路径写 `\`。 */
function splitSegments(path: string): string[] {
  return path.split(SEGMENT_SPLIT);
}

function trimTrailingEmptySegments(segments: string[]): string[] {
  const out = [...segments];
  while (out.length > 1 && out.at(-1) === "") {
    out.pop();
  }
  return out;
}

/** 绝对路径判据落在原始字符串上：POSIX 根、Windows 盘符与 UNC 两头都认。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(path);
}

/**
 * POSIX 语义的 `rel(from, to)`，分隔符两头认、输出一律 `/`。
 * 一侧绝对一侧相对、或 Windows 盘符不同（含大小写差异）时无从算起，交回 null；
 * 调用方对 null 的处理是「这一档不收」，方向是保守的。
 */
function relativeSegments(from: string, to: string): string[] | null {
  const absolute = isAbsolutePath(from);
  if (absolute !== isAbsolutePath(to)) {
    return null;
  }
  const fromSegments = trimTrailingEmptySegments(splitSegments(from));
  const toSegments = trimTrailingEmptySegments(splitSegments(to));
  if (absolute && fromSegments[0] !== toSegments[0]) {
    return null;
  }
  let shared = 0;
  while (
    shared < fromSegments.length &&
    shared < toSegments.length &&
    fromSegments[shared] === toSegments[shared]
  ) {
    shared += 1;
  }
  return [
    ...Array.from({ length: fromSegments.length - shared }, () => ".."),
    ...toSegments.slice(shared),
  ];
}

/**
 * 行首以 `/` 连接的可用前缀。`..` 开头的段串不整段丢弃：cwd 是包根的兄弟目录时前缀形如
 * `../plugins/foo`，行首相对段收掉后剩余部分恰好是它，所以只跳过行首的 `..` 段再取剩余；
 * 只剩 `..`（cwd 在包根之下）则无前缀可用，交回空串。
 */
function usablePrefix(segments: string[] | null): string {
  if (segments === null || segments.length === 0) {
    return "";
  }
  let start = 0;
  while (start < segments.length && segments[start] === "..") {
    start += 1;
  }
  return start === segments.length ? "" : segments.slice(start).join("/");
}

/**
 * cwd 已知时按调用方几何算出的两枚前缀：自有模块的 `rel(cwd, 包根)` 与同级依赖共用的
 * `rel(cwd, 包根父目录)`。收不到（相对形态、盘符不符、cwd 就在包根）时为空串。
 */
function prefixesFor(cwd: string, pkgDir: string): { own: string; parent: string } {
  return {
    own: usablePrefix(relativeSegments(cwd, pkgDir)),
    parent: usablePrefix(relativeSegments(cwd, parentDirOf(pkgDir))),
  };
}

/**
 * 按算好的前缀收行首：自有前缀优先（最具体），命中即收；否则收父目录前缀——剩下的首段
 * 是依赖包名，canonical 形态要保留它。都没有命中就原样交回。
 */
function stripByPrefixes(path: string, prefixes: { own: string; parent: string }): string {
  if (prefixes.own.length > 0 && path.startsWith(`${prefixes.own}/`)) {
    return path.slice(prefixes.own.length + 1);
  }
  if (prefixes.parent.length > 0 && path.startsWith(`${prefixes.parent}/`)) {
    return path.slice(prefixes.parent.length + 1);
  }
  return path;
}

/**
 * 折单行。调用方已用 {@link REGION_LINE} 预筛出行首前缀，所以这里**只**动标记之后的那段
 * 路径文本，不再重复判前缀——单行字符串里的同形内容由那条正则的行首锚点挡在射程外；
 * 跨行模板字面量里以标记起行的内容，只有不像模块路径（带空白/引号/反引号）的才会被
 * {@link REGION_PATH_SHAPE} 挡下，与真标记逐字符同形的仍会被改写（残余局限，见该常量）。
 * @param line - 已确认以 `//#region ` 开头的一行
 * @param anchors - 见 {@link leadingAnchors}（cwd 未传时使用）
 * @param prefixes - 见 {@link prefixesFor}（cwd 已传时使用）
 * @returns canonical 形态的那一行
 */
function canonicalizeLine(
  line: string,
  anchors: string[],
  prefixes: { own: string; parent: string } | null,
): string {
  const path = line.slice(REGION_MARK.length);
  if (!REGION_PATH_SHAPE.test(path)) {
    return line;
  }
  const folded = path.replace(LEADING_RELATIVE_SEGMENTS, "");
  const stripped =
    prefixes === null ? stripLeadingAnchor(folded, anchors) : stripByPrefixes(folded, prefixes);
  return `${REGION_MARK}${stripped}`;
}

/**
 * 产物文本的 canonical 形态：所有 `//#region` 行折成与 process.cwd() 无关的形状，其余字节原样保留。
 * @param code - builder 拿到的产物文本
 * @param pkgDir - 包根绝对路径（builder 的 import.meta.dirname）
 * @param cwd - 构建时的 process.cwd()。传入即走精确前缀档；省略走旧签名兼容档
 * @returns 与 process.cwd() 无关的同一份文本；对 canonical 输入幂等（残余局限见文件头）
 */
export function canonicalizeRegionPaths(code: string, pkgDir: string, cwd?: string): string {
  const anchors = leadingAnchors(pkgDir);
  if (cwd === undefined) {
    if (anchors.length === 0) {
      return code;
    }
    return code.replaceAll(REGION_LINE, (line) => canonicalizeLine(line, anchors, null));
  }
  const prefixes = prefixesFor(cwd, pkgDir);
  return code.replaceAll(REGION_LINE, (line) => canonicalizeLine(line, anchors, prefixes));
}
