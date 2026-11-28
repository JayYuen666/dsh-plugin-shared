// build-host.mjs 的声明（供 test/build-host.test.ts 侧类型化导入）。
// 与兄弟包不同：本包的 buildHost() 返回「写到磁盘绝对路径 → 文件文本」的 Map，
// 由 materialize() 统一写盘并按相对路径清理 host 拥有的旧产物（多入口 + code-split，
// chunk 名带 hash 故不能在类型里写死文件名）。
export function buildHost(): Promise<Map<string, string>>;

/**
 * 写产物并只清理 host 拥有的陈旧文件（根层 `.js`，`client.js` 除外；历史根声明 `index.d.ts`；
 * 以及 `build/` 子树；config/types 不碰）。
 * @param built - buildHost() 交回的清单
 * @param targetDir - 目标 dist；缺省为本包 dist
 */
export function materialize(
  built: Map<string, string>,
  targetDir?: string,
): Promise<{ artifacts: number; pruned: string[] }>;

/** 各模块子路径名（`./internal/tool/*` 的 dist/<module>.js 来源）。 */
export const facets: string[];
