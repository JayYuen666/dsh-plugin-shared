// lib/build-tool-imports.ts —— 消费方 host 构建的统一入口：把 shared `/tool` 的具名导入
// 在构建期拆成 `internal/tool/<module>`，再交给官方 `@rolldown/plugin-transform-imports`。
//
// 为什么不是每个包各写一份：官方插件只按 member 重写，不认识 TypeScript 的 `importKind`。
// 直接把它接到源码上，`import { type MessagesCatalog, fillPlaceholders }` 会把类型名也当成
// member 拼路径；每个消费方各自补一遍守卫，就是一份份会漂移的实现。这里把「type-only 收窄 +
// 入口形状 + 再导出拒绝」与「tool-map → 官方 transform 配置」收在一处，消费方只注入自己的
// 官方插件与 parseAst。
//
// 这个切面是**构建期**面：产物落 dist/build/，消费方按 `./lib/build-tool-imports` 取用。
// 它不进根 barrel，也不在插件运行期被 import。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { RolldownPluginOption } from "rolldown";

/** shared 的包名；与 package.json 的 name 同源。 */
const SHARED_PACKAGE = "@jayyuen66/dsh-plugin-shared";
/** 运行期唯一工具入口。 */
export const SHARED_TOOL_SPECIFIER = `${SHARED_PACKAGE}/tool`;
/** 构建期拆分后的模块前缀；消费方源码不得直接 import。 */
export const SHARED_INTERNAL_TOOL_PREFIX = `${SHARED_PACKAGE}/internal/tool`;

/** 模块名只允许小写字母、数字与连字符；tool-map 的每个目标都要过这一条。 */
const MODULE_NAME = /^[a-z0-9-]+$/u;
/**
 * 可路由导出名：能被无引号写回具名导入，且不含正则元字符。
 *
 * 官方插件把成员名原样编进 `new RegExp("^" + name + "$")`，又在重建导入时不补引号，
 * 所以 `foo$`（合法标识符、但是正则元字符）与 `"a-b"`（字面量名）都无法表达。
 * 这条判据收在 tool-map 的入口处：生成侧出现这类名字时，消费方构建要在这里点名失败，
 * 而不是把一条官方插件匹配不到的成员留到装载期。
 */
const ROUTABLE_EXPORT_NAME = /^[A-Za-z_]\w*$/u;

/** 导出名 → 稳定模块名。值是 `dist/<module>.js` 的模块名，不含目录与扩展名。 */
export type ToolImportMap = Readonly<Record<string, string>>;
/** 校验后的映射快照：只含自有条目，不受原型链与 `__proto__` 赋值语义影响。 */
export type ToolImportSnapshot = ReadonlyMap<string, string>;

/** 本切面用到的最小 AST 形状：只覆盖 import/export 声明需要的字段。 */
export interface ToolAstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/** `parseAst` 的最小形状；消费方注入自己的 `rolldown/parseAst`。 */
export interface ToolAstProgram {
  readonly body: readonly ToolAstNode[];
}

/** 消费方注入的 AST 解析器。 */
export type ToolParseAst = (
  code: string,
  options: { readonly lang: "ts" | "tsx" },
  id: string,
) => ToolAstProgram;

/** 官方 transform-imports 需要的单条路由配置。 */
export interface ToolImportRoute {
  readonly transform: [string, string][];
  readonly skipDefaultConversion: true;
  readonly preventFullImport: true;
}

/** 官方 `@rolldown/plugin-transform-imports` 默认导出的最小形状。 */
export type TransformImportsFactory = (
  options: Record<string, ToolImportRoute>,
) => RolldownPluginOption;

/** `toolImportTransform()` 的入参。 */
export interface ToolImportTransformOptions {
  /** 官方插件的默认导出；由消费方在自己的 node_modules 里解析。 */
  readonly transformImports: TransformImportsFactory;
  /** 与装饰器预转换共用同一份 `rolldown/parseAst`。 */
  readonly parseAst: ToolParseAst;
  /** 测试或特殊构建可注入；缺省读包内 `dist/tool-map.json`。会与文件形态走同一条校验。 */
  readonly toolMap?: ToolImportMap | ToolImportSnapshot;
}

interface ImportSpecifierNode extends ToolAstNode {
  readonly type: "ImportSpecifier";
  readonly imported:
    | { readonly type: "Identifier"; readonly name: string }
    | { readonly type: "Literal"; readonly value: string };
  readonly local: { readonly name: string };
  readonly importKind?: "type" | "value";
}

interface ImportDeclarationNode extends ToolAstNode {
  readonly type: "ImportDeclaration";
  readonly source: { readonly value: string };
  readonly importKind?: "type" | "value";
  /** `with { … }` 的导入属性；官方 transform 重建导入时不保留，必须显式拒绝。 */
  readonly attributes?: readonly unknown[];
  readonly specifiers: readonly (
    | ImportSpecifierNode
    | (ToolAstNode & { readonly type: "ImportDefaultSpecifier" | "ImportNamespaceSpecifier" })
  )[];
}

interface ExportSpecifierNode extends ToolAstNode {
  readonly type: "ExportSpecifier";
  readonly local: { readonly name: string };
  readonly exportKind?: "type" | "value";
}

interface ReexportDeclarationNode extends ToolAstNode {
  readonly type: "ExportNamedDeclaration" | "ExportAllDeclaration";
  readonly source?: { readonly value: string } | null;
  readonly exportKind?: "type" | "value";
  readonly specifiers?: readonly ExportSpecifierNode[];
}

interface ExportNamedDeclarationNode extends ToolAstNode {
  readonly type: "ExportNamedDeclaration";
  readonly source: { readonly value: string } | null;
  readonly exportKind?: "type" | "value";
  readonly specifiers: readonly ExportSpecifierNode[];
}

interface IdentifierNode extends ToolAstNode {
  readonly type: "Identifier";
  readonly name: string;
}

/** TypeScript 只影响类型、擦除后仍是同一表达式的包装节点。 */
interface TransparentExpressionNode extends ToolAstNode {
  readonly expression: ToolAstNode;
}

const TRANSPARENT_EXPRESSION_TYPES: ReadonlySet<string> = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "TSTypeAssertion",
]);

interface ExportDefaultDeclarationNode extends ToolAstNode {
  readonly type: "ExportDefaultDeclaration";
  readonly declaration: ToolAstNode;
}

/** 一条文本替换；按 start 倒序执行，避免前面的替换移动后面的偏移。 */
interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** 当前文件的解析形态：`lang` 交给解析器，`routable` 表示官方插件能否认这个扩展名。 */
interface SourceKind {
  readonly lang: "ts" | "tsx";
  readonly routable: boolean;
}

function isImportDeclaration(node: ToolAstNode): node is ImportDeclarationNode {
  return node.type === "ImportDeclaration";
}

function isReexportDeclaration(node: ToolAstNode): node is ReexportDeclarationNode {
  return node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration";
}

function isExportNamedDeclaration(node: ToolAstNode): node is ExportNamedDeclarationNode {
  return node.type === "ExportNamedDeclaration";
}

function isExportDefaultDeclaration(node: ToolAstNode): node is ExportDefaultDeclarationNode {
  return node.type === "ExportDefaultDeclaration";
}

function isIdentifier(node: ToolAstNode): node is IdentifierNode {
  return node.type === "Identifier";
}

function isTransparentExpression(node: ToolAstNode): node is TransparentExpressionNode {
  return TRANSPARENT_EXPRESSION_TYPES.has(node.type);
}

/**
 * 校验 map 条目里的导出名能否被官方插件路由。
 * @param exported - 导出名
 * @param source - 报错时点名的文件
 */
function assertRoutableExportName(exported: string, source: string): void {
  if (!ROUTABLE_EXPORT_NAME.test(exported)) {
    throw new TypeError(
      `${source} 的导出名 ${JSON.stringify(exported)} 无法路由；` +
        "官方 transform 按 RegExp 匹配成员，导出名只能是 ASCII 标识符",
    );
  }
}

/**
 * 把一条映射写进快照，记录形态与快照形态共用这一条判据。
 * @param target - 目标快照
 * @param exported - 导出名
 * @param moduleName - 目标模块名，未知形态先判类型
 * @param source - 报错时点名的文件或选项名
 */
function addToolMapEntry(
  target: Map<string, string>,
  exported: string,
  moduleName: unknown,
  source: string,
): void {
  assertRoutableExportName(exported, source);
  if (typeof moduleName !== "string" || !MODULE_NAME.test(moduleName)) {
    throw new TypeError(
      `${source} 的 ${exported} 指向非法模块名 ${String(moduleName)}；模块名只允许小写字母、数字与连字符`,
    );
  }
  target.set(exported, moduleName);
}

/**
 * 校验并快照 tool-map：空表、非字符串值、不可路由的导出名都会让 transform 静默失效。
 * @param raw - JSON.parse 的未知值或注入的映射
 * @param source - 报错时点名的文件或选项名
 * @returns 只含自有条目的快照
 */
function snapshotToolMap(raw: unknown, source: string): ToolImportSnapshot {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${source} 不是「导出名 → 模块名」的对象`);
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new TypeError(`${source} 是空表；shared 至少应有一个运行期导出`);
  }
  const toolMap = new Map<string, string>();
  for (const [exported, moduleName] of entries) {
    addToolMapEntry(toolMap, exported, moduleName, source);
  }
  return toolMap;
}

/**
 * 注入映射是不是已经校验过的快照形态。
 * @param toolMap - 注入的映射或快照
 * @returns 是否为 Map 形态
 */
function isToolImportSnapshot(
  toolMap: ToolImportMap | ToolImportSnapshot,
): toolMap is ToolImportSnapshot {
  return toolMap instanceof Map;
}

/**
 * 把注入的映射收成快照：Map 形态逐条复验后复制，记录形态的走与文件相同的校验。
 *
 * 复制是刻意的：调用方在插件创建后改自己的表，不应该改变已经生成的守卫与路由。
 * @param toolMap - 注入的映射或快照
 * @param source - 报错时点名的选项名
 * @returns 校验后的快照
 */
function toSnapshot(
  toolMap: ToolImportMap | ToolImportSnapshot,
  source: string,
): ToolImportSnapshot {
  if (!isToolImportSnapshot(toolMap)) {
    return snapshotToolMap(toolMap, source);
  }
  const snapshot = new Map<string, string>();
  for (const [exported, moduleName] of toolMap.entries()) {
    addToolMapEntry(snapshot, exported, moduleName, source);
  }
  if (snapshot.size === 0) {
    throw new TypeError(`${source} 是空表；shared 至少应有一个运行期导出`);
  }
  return snapshot;
}

/**
 * 读 shared 自己构建出的 `dist/tool-map.json`。
 *
 * 用 `createRequire` 解析自己的 `package.json`，而不是按 `import.meta.dirname` 的层级拼
 * `../tool-map.json`：源码态在 `lib/`、产物态在 `dist/build/`，两者到 dist 的深度不同。
 * 自引用解析在两种形态下都落到包根。
 * @returns 导出名到模块名的快照
 */
function readToolMap(): ToolImportSnapshot {
  const require = createRequire(import.meta.url);
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${SHARED_PACKAGE}/package.json`);
  } catch (error) {
    throw new Error(
      `解析不到 ${SHARED_PACKAGE}/package.json；构建器应从消费方的 node_modules 取 shared。原因：${String(error)}`,
      { cause: error },
    );
  }
  const mapPath = path.join(path.dirname(manifestPath), "dist", "tool-map.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(mapPath, "utf8"));
  } catch (error) {
    throw new Error(
      `读不出 shared 的 ${mapPath}：先运行 cd ${path.dirname(manifestPath)} && node build-host.mjs。原因：${String(error)}`,
      { cause: error },
    );
  }
  return snapshotToolMap(raw, mapPath);
}

/**
 * 当前模块 id 的解析形态；不是 TypeScript 源码时返回 null。
 *
 * 先剥 query 再取扩展名：`entry.js?file=other.ts` 不是 TS 源，而 `x.ts?raw` 是。
 * `.mts` / `.cts` 仍按 TS 解析，但官方插件的 id 过滤面只认 `[jt]sx`，所以它们不可路由。
 * @param id - 模块 id
 * @returns 解析形态或 null
 */
function sourceKindOf(id: string): SourceKind | null {
  const query = id.indexOf("?");
  const file = query === -1 ? id : id.slice(0, query);
  const tsx = file.endsWith(".tsx");
  const ts = file.endsWith(".ts");
  if (!tsx && !ts && !file.endsWith(".mts") && !file.endsWith(".cts")) {
    return null;
  }
  return {
    lang: tsx ? "tsx" : "ts",
    routable: tsx || ts,
  };
}

function valueSpecifierText(
  specifier: ImportSpecifierNode,
  toolMap: ToolImportSnapshot,
  id: string,
): string | null {
  if (specifier.importKind === "type") {
    return null;
  }
  const imported =
    specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
  if (specifier.imported.type === "Literal" && !ROUTABLE_EXPORT_NAME.test(imported)) {
    throw new Error(
      `${id} 用字面量名 ${JSON.stringify(imported)} 导入 shared/tool；只支持能无引号写回的标识符导出名。`,
    );
  }
  if (!toolMap.has(imported)) {
    throw new Error(
      `${id} 导入了 shared/tool 的 ${imported}，但 dist/tool-map.json 没有它。` +
        "shared 新增导出后需重新构建 shared。",
    );
  }
  const local = specifier.local.name;
  return imported === local ? imported : `${imported} as ${local}`;
}

/**
 * 把一条 `/tool` 导入收窄成纯值具名导入的文本；没有值说明符时返回分号。
 *
 * 分号不是格式偏好：整条声明被删掉时，换行挡不住 ASI 把前后两条语句接起来
 * （`run()` + `[1].forEach(f)` 会解析成 `run()[1].forEach(f)`），空语句 `;` 才是边界。
 * @param node - 已确认来源为 `/tool` 的导入声明
 * @param toolMap - 校验后的导出名到模块名快照
 * @param id - 当前模块 id（报错定位）
 * @returns 替换后的 import 文本或 `";"`
 */
function valueImportText(
  node: ImportDeclarationNode,
  toolMap: ToolImportSnapshot,
  id: string,
): string {
  const values: string[] = [];
  for (const specifier of node.specifiers) {
    if (specifier.type !== "ImportSpecifier") {
      throw new Error(
        `${id} 对 shared/tool 使用了非具名导入；只允许 import { ... } from "${SHARED_TOOL_SPECIFIER}"。`,
      );
    }
    const value = valueSpecifierText(specifier, toolMap, id);
    if (value !== null) {
      values.push(value);
    }
  }
  return values.length === 0
    ? ";"
    : `import { ${values.join(", ")} } from "${SHARED_TOOL_SPECIFIER}";`;
}

/**
 * 一条 `/tool` 导入声明需要的文本替换；不是 `/tool` 的导入时返回 null。
 * @param node - 顶层语句
 * @param toolMap - 导出名到模块名快照
 * @param id - 当前模块 id
 * @param forwarded - 收集值导入的本地名，供再导出检查
 * @returns 文本替换或 null
 */
function importEdit(
  node: ToolAstNode,
  toolMap: ToolImportSnapshot,
  id: string,
  forwarded: Set<string>,
): TextEdit | null {
  if (!isImportDeclaration(node) || node.source.value !== SHARED_TOOL_SPECIFIER) {
    return null;
  }
  if (node.importKind === "type") {
    return { start: node.start, end: node.end, text: ";" };
  }
  if (Array.isArray(node.attributes) && node.attributes.length > 0) {
    throw new Error(
      `${id} 对 shared/tool 的导入带 import attributes；` +
        "官方 transform 重建导入时会丢掉它们，只支持无 attributes 的具名导入。",
    );
  }
  if (node.specifiers.length === 0) {
    throw new Error(
      `${id} 对 shared/tool 使用了 side-effect import；只允许 import { ... } from "${SHARED_TOOL_SPECIFIER}"。`,
    );
  }
  const text = valueImportText(node, toolMap, id);
  for (const specifier of node.specifiers) {
    if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
      forwarded.add(specifier.local.name);
    }
  }
  return { start: node.start, end: node.end, text };
}

/**
 * 一条 `export … from "/tool"` 需要的文本替换。
 *
 * 类型再导出整条删除（官方插件会重建并丢掉 `type` 标记，留着会变成值导出）；
 * 值再导出一律拒绝。
 * @param node - 顶层语句
 * @param id - 当前模块 id
 * @returns 文本替换或 null
 */
function reexportEdit(node: ToolAstNode, id: string): TextEdit | null {
  if (!isReexportDeclaration(node) || node.source?.value !== SHARED_TOOL_SPECIFIER) {
    return null;
  }
  const specifiers = node.specifiers ?? [];
  const onlyTypes =
    node.exportKind === "type" || specifiers.every((specifier) => specifier.exportKind === "type");
  if (onlyTypes && (node.type === "ExportNamedDeclaration" || node.exportKind === "type")) {
    return { start: node.start, end: node.end, text: ";" };
  }
  throw new Error(`${id} 从 shared/tool 再导出；消费方只允许在本地使用 shared 的值，不允许转发。`);
}

/**
 * 本地 `export { … }` 里有没有被转发的 `/tool` 值。
 * 整条 `export type { … }` 先按类型面放行（与说明符级 `export { type T }` 同一条规则）。
 * @param node - `export { … }` 声明
 * @param forwarded - 值导入的本地名
 * @param id - 当前模块 id
 */
function assertSpecifiersNotForwarded(
  node: ExportNamedDeclarationNode,
  forwarded: ReadonlySet<string>,
  id: string,
): void {
  if (node.exportKind === "type") {
    return;
  }
  for (const specifier of node.specifiers) {
    if (specifier.exportKind !== "type" && forwarded.has(specifier.local.name)) {
      throw new Error(
        `${id} 把 shared/tool 的值 ${specifier.local.name} 再导出；消费方只允许在本地使用 shared 的值，不允许转发。`,
      );
    }
  }
}

/**
 * `export default <标识符>` 有没有被转发的 `/tool` 值。
 * @param node - `export default` 声明
 * @param forwarded - 值导入的本地名
 * @param id - 当前模块 id
 */
function assertDefaultNotForwarded(
  node: ExportDefaultDeclarationNode,
  forwarded: ReadonlySet<string>,
  id: string,
): void {
  let { declaration } = node;
  while (isTransparentExpression(declaration)) {
    declaration = declaration.expression;
  }
  if (isIdentifier(declaration) && forwarded.has(declaration.name)) {
    throw new Error(
      `${id} 把 shared/tool 的值 ${declaration.name} 再导出；消费方只允许在本地使用 shared 的值，不允许转发。`,
    );
  }
}

/**
 * 拒绝把 `/tool` 的值导入再导出（`export { f }` / `export default f`）。
 *
 * `export … from` 由 {@link reexportEdit} 覆盖；这里补的是「先导入、再本地导出」那条路径。
 * 类型面的转发不拦：它会被 TypeScript 擦掉，不产生运行期身份。
 * @param ast - 顶层 AST
 * @param forwarded - 值导入的本地名
 * @param id - 当前模块 id
 */
function assertNoForwarding(ast: ToolAstProgram, forwarded: ReadonlySet<string>, id: string): void {
  for (const node of ast.body) {
    if (isExportNamedDeclaration(node)) {
      if (node.source === null) {
        assertSpecifiersNotForwarded(node, forwarded, id);
      }
    } else if (isExportDefaultDeclaration(node)) {
      assertDefaultNotForwarded(node, forwarded, id);
    }
  }
}

/**
 * 把 `/tool` 的源码导入收窄成官方 transform 能处理的纯值具名导入。
 *
 * 官方插件只按 member 重写，不认识 `importKind`；这里补四件它不覆盖的事：
 *   1. 丢掉 type-only 导入/说明符/再导出（不产生运行期字节，也不该进 tool-map）；
 *   2. 拒绝 default / namespace / side-effect 导入与 import attributes，保持「只允许具名值」的入口契约；
 *   3. 拒绝把 `/tool` 的值再导出（`export … from` 与「先导入再导出」两种写法）；
 *   4. 校验每条值导入都在 tool-map 里，且名字能被官方插件路由。
 * 另外挡住官方插件根本不会处理的 `.mts` / `.cts` 值导入；纯类型导入仍可剥离。
 * 剩下的纯值 import 仍保留 `/tool` 说明符，交给紧随其后的官方插件按 map 拆分。
 * @param options - 解析器与导出表
 * @returns Rolldown 插件
 */
export function toolImportGuard(options: {
  readonly parseAst: ToolParseAst;
  readonly toolMap: ToolImportMap | ToolImportSnapshot;
}): RolldownPluginOption {
  const toolMap = toSnapshot(options.toolMap, "toolImportGuard 的 toolMap");
  return {
    name: "dsh-plugin-shared/tool-import-guard",
    transform(code, id) {
      const kind = sourceKindOf(id);
      if (kind === null) {
        return null;
      }
      // 不做 `code.includes` 预筛选：转义写法（`".../t\u006fol"`）的值也是 /tool，
      // 预筛选会静默跳过守卫；而这里重建导入时写回的是字面说明符，官方插件的
      // 文本过滤随后就能命中。
      const ast = options.parseAst(code, { lang: kind.lang }, id);
      const forwarded = new Set<string>();
      const edits: TextEdit[] = [];
      for (const node of ast.body) {
        const edit = reexportEdit(node, id) ?? importEdit(node, toolMap, id, forwarded);
        if (edit !== null) {
          edits.push(edit);
        }
      }
      assertNoForwarding(ast, forwarded, id);
      if (!kind.routable && forwarded.size > 0) {
        throw new Error(
          `${id} 从 shared/tool 取值，但官方 transform 的 id 过滤面只认 [jt]sx，` +
            "无法把 .mts/.cts 拆成 internal/tool/*；请把该入口改成 .ts。",
        );
      }
      if (edits.length === 0) {
        return null;
      }
      // 倒序执行：只改本函数的局部数组，不碰调用方输入。
      edits.sort((left, right) => right.start - left.start);
      let rewritten = code;
      for (const edit of edits) {
        rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
      }
      // 不返回 map：host 构建当前不产 sourcemap（buildHostEntries 未开该选项）。
      // 将来若开启，这里需要把逐条替换合成进上一段插件交来的映射。
      return { code: rewritten };
    },
  };
}

/**
 * 生成消费方 host 构建需要的两条插件：先收窄 `/tool` 源码，再让官方插件按 tool-map 拆分。
 *
 * 顺序不能反：官方插件先跑会把 type-only 成员也当成模块名拼路径。装饰器预转换必须排在
 * 这两条之前，否则 tsc 重新编译 `@Remote` 文件时会把已经拆开的 import 覆盖回 `/tool`。
 * @param options - 官方插件工厂、解析器与可选 tool-map
 * @returns `[guard, transformImports]`，按顺序展开进 `buildHostEntries` 的 `plugins`
 */
export function toolImportTransform(options: ToolImportTransformOptions): RolldownPluginOption[] {
  const toolMap =
    options.toolMap === undefined
      ? readToolMap()
      : toSnapshot(options.toolMap, "toolImportTransform 的 toolMap 选项");
  const transform: [string, string][] = [...toolMap.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([exported, moduleName]): [string, string] => [
      exported,
      `${SHARED_INTERNAL_TOOL_PREFIX}/${moduleName}`,
    ]);
  return [
    toolImportGuard({ parseAst: options.parseAst, toolMap }),
    options.transformImports({
      [SHARED_TOOL_SPECIFIER]: {
        transform,
        skipDefaultConversion: true,
        preventFullImport: true,
      },
    }),
  ];
}
