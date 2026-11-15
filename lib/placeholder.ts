// lib/placeholder.ts —— 宿主侧文案的 `{name}` 占位符插值（唯一一份实现）。
//
// 为什么收在一处：六个插件各写了一遍同一个函数（`fillTemplate` / `fill` / `format` /
// `renderTemplate`），去掉注释后都是「正则全文替换 + 只取自有属性」。此前它们分成两派语义——
// 占位符没给值时**保留原文**（两处）或**替成空串**（四处）——而这两种在消费点上看不出区别：
// 少传一个参数时，一派让模型读到 `{detail}`，另一派让模型读到一句缺了主语的话。统一成
// 「保留原文」：写错占位符时原样照出、一眼可见，也不会让一句文案悄悄塌成残句。
//
// 键的形状取「花括号里任何不含花括号的内容」，而不是只认 `\w+`：六份旧实现里有一份
// （quality-gate 的 `renderTemplate`）刻意支持 `{gate.command}` 这种带点的名字，并有用例
// 钉着它。宽形状与「缺值保留原文」并不冲突——没提供的宽名字原样留着（写错时肉眼可见），
// 提供了才替换，所以挪到统一实现上，宽名字那一条行为不变。
//
// 值按 `String()` 原样插入，不做转义、不做换行归一：注入模型的调用点要自己定界（各包用
// fence/换行包裹不可信值）。原型链上的同名成员（`{constructor}` / `{toString}`）不取——
// 只认自有属性，否则模板里出现 `{toString}` 会把一个函数插进文案。
//
// `undefined` 与「没有这个键」同义，保留占位符原文（渲染成 "undefined" 只会把一句人读的
// 文案变成半句机器话）；**`null` 不是缺失**，按 `String(null)` 渲染成 "null"：它是调用方
// 明确交出来的一个值（`exitCode: number | null` 这种形状很常见），模板字符串里 `${null}`
// 也渲染成 "null"—把两者对齐，才不会让"命令没有退出码"与"模板里少传一个键"看起来一样。

/** 一次插值能接受的值域：字符串、数字、`null`，或缺失（只有 `undefined` 算缺失）。 */
export type PlaceholderValues = Readonly<Record<string, string | number | null | undefined>>;

/** 占位符字形：一层花括号包住任意不含花括号的内容（键名可带点，见文件头）。 */
const PLACEHOLDER = /\{(?<key>[^{}]+)\}/gu;

/** 取到的值是否可以插进文案（只有 `undefined` 算缺失，`null` 照实渲染）。 */
function textOf(value: string | number | null | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/**
 * 把 `template` 里的 `{name}` 换成 `values` 对应的值。
 *
 * 未出现在 `values` 自有属性里、或显式传 `undefined` 的占位符**原样留在输出里**
 * （写错占位符时肉眼可见）；`null` 照实渲染成 "null"（它是调用方交出来的值，见文件头）。
 * @param template - 含 `{name}` 占位符的文案模板。
 * @param values - 占位符名 → 值。
 * @returns 插值后的文本。
 */
export function fillPlaceholders(template: string, values: PlaceholderValues): string {
  return template.replaceAll(PLACEHOLDER, (token: string, key: string): string => {
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    return textOf(value) ?? token;
  });
}
