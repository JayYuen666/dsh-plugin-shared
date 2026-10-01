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
// 折法只有两条，都锚在**行首**（绝不碰路径中段，也绝不碰非 region 行）：
//   1) 收掉行首的相对段（`./` 与 `../` 的任意串）；
//   2) 依次收掉行首的两枚锚点段——「包根的父目录名」与「包名」，只按**整段**匹配。
//      整段匹配是必需的：`@jayyuen66/dsh-plugin-shared` 把 `shared` 当子串，若按子串折，
//      shared 自己的产物会把 node_modules 路径误折成 `lib/index.js`。
// 两条都幂等：canonical 形态既不行首带相对段，也不以这两枚锚点段开头。
//
// 只在 builder 侧调用：本模块**不进 barrel、不进 shared/build-host.mjs 的 facets**。它是构建
// 脚本用的纯字符串函数，不是插件运行时 API；进了 barrel 就会被 host 产物内联进去，白占体积。
// 也**不进 shared/package.json 的 `exports`**：包代码用包名说明符引 shared 是因为那是要发布的
// 运行时 API，而本模块的调用方是各包的 `build-*.mjs`——它们根本不在 `files`（各包 files 只有
// `host.js`/`client.js`/`cordis.patch.yml`），也不是 `publish-check/repo-surface.mjs` 扫的配置面
// （那里只查根层配置，源码/脚本里的 `../` 明确不受这棵树限制）。所以 builder 用仓内相对说明符
// `../shared/lib/canonicalize-region-paths.ts` 是有意的，不是漏了 `exports` 条目。
//
// 纯字符串：不起子进程、不读盘、不 import node:path —— 包根由调用方（builder 里已有的
// import.meta.dirname）作为字符串交进来，本模块只做行内文本重写。因此可单测，也能在同一进程
// 里对两侧（内存构建 / 磁盘产物）反复调用而不引入新的环境依赖。

/** rolldown 模块标记的前缀。`//#endregion` 与代码里的任何其它行都不在本函数的射程内。 */
const REGION_MARK = "//#region ";

/** 路径行首的相对段（`./` 与 `../` 的任意串），收掉后跨包依赖在两处 cwd 下才同形。 */
const LEADING_RELATIVE_SEGMENTS = /^(?:\.\.?\/)+/u;

/**
 * 取路径的末段。分隔符两头认：产物里的模块路径由 rolldown 写成 `/`，
 * 而 `import.meta.dirname` 在 Windows 上是 `\`。
 * @param dir - 目录路径
 * @returns 末段；只剩分隔符时为空串
 */
function lastSegment(dir: string): string {
  const trimmed = dir.replace(/[/\\]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/**
 * 行首可被收掉的两枚锚点段：包根的父目录名（DSH_HOME 当 cwd 时多出来那一段）与包名。
 * @param pkgDir - 包根路径（调用方的 import.meta.dirname）
 * @returns 按序待收的段名；空串（pkgDir 只剩分隔符、或压根没有父目录）已剔除
 */
function leadingAnchors(pkgDir: string): string[] {
  const pkgName = lastSegment(pkgDir);
  const parent = pkgDir.slice(0, pkgDir.length - pkgName.length);
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
 * 折单行：命中 `//#region ` 前缀才动刀，且只动该行之后的那段路径文本。
 * 代码中间的字符串（哪怕原样写着 `//#region foo/`）不在射程内——判据是整行行首。
 * @param line - 产物里的一行
 * @param anchors - 见 {@link leadingAnchors}
 * @returns canonical 形态的那一行
 */
function canonicalizeLine(line: string, anchors: string[]): string {
  if (line.startsWith(REGION_MARK)) {
    const folded = line.slice(REGION_MARK.length).replace(LEADING_RELATIVE_SEGMENTS, "");
    return `${REGION_MARK}${stripLeadingAnchor(folded, anchors)}`;
  }
  return line;
}

/**
 * 产物文本的 canonical 形态：所有 `//#region` 行折成相对包根的形状，其余字节原样保留。
 * @param code - builder 拿到的产物文本
 * @param pkgDir - 包根绝对路径（builder 的 import.meta.dirname）
 * @returns 与 process.cwd() 无关的同一份文本；对 canonical 输入幂等
 */
export function canonicalizeRegionPaths(code: string, pkgDir: string): string {
  const anchors = leadingAnchors(pkgDir);
  if (anchors.length === 0) {
    return code;
  }
  return code
    .split("\n")
    .map((line) => canonicalizeLine(line, anchors))
    .join("\n");
}
