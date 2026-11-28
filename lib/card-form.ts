// lib/card-form.ts —— 卡片草稿层的纯函数骨架（不依赖 React、不依赖 zod）。
//
// 为什么值得单点定义：七张设置卡各自写了 `setField`（touched 层写一格）、`eff`
//（草稿优先、快照兜底）与 `boundsOf`（从 zod schema 读显式上下界）。这些是机械件，
// 领域判断（哪些字段、怎么解析、错误文案）留在各卡；本文件只提供值语义。
//
// `effectiveField` 刻意用 `Object.hasOwn` 而不是 `field in touched`：后者对
// `constructor` / `__proto__` 这类继承键也为真，字段名一旦来自数据就会读到原型成员。
// 当前各卡字段名都是 schema 常量，但 shared 化的接口不能把这条隐式前提写进契约。

/** zod 4.6 的 `.minValue`/`.maxValue` 形状：`null` 表示该方向没声明。 */
export interface NumberBoundsSchema {
  readonly minValue: number | null;
  readonly maxValue: number | null;
}

/** 可选边界；两个方向都可能缺席。 */
export interface NumberBounds {
  readonly min?: number;
  readonly max?: number;
}

/** 两个方向都给的兜底边界（zvec/ocr 的 `schema.minValue ?? LIMIT_MIN` 形态）。 */
export interface NumberBoundsFallback {
  readonly min: number;
  readonly max: number;
}

/**
 * 从 zod 数值 schema 读显式边界；不给 fallback 时缺席方向不编造上限。
 * @param schema - 带 `minValue`/`maxValue` 的 zod 数值 schema
 * @returns 只含已声明方向的边界对象
 */
export function numberBoundsOf(schema: NumberBoundsSchema): NumberBounds;
/**
 * 从 zod 数值 schema 读边界，缺席方向落 fallback（必须两个方向都给）。
 * @param schema - 带 `minValue`/`maxValue` 的 zod 数值 schema
 * @param fallback - 两个方向的兜底值
 * @returns 两个方向都有的边界
 */
export function numberBoundsOf(
  schema: NumberBoundsSchema,
  fallback: NumberBoundsFallback,
): NumberBoundsFallback;
export function numberBoundsOf(
  schema: NumberBoundsSchema,
  fallback?: NumberBoundsFallback,
): NumberBounds {
  const min = schema.minValue ?? fallback?.min;
  const max = schema.maxValue ?? fallback?.max;
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

/**
 * 在 touched 层写一格，返回新记录；不改入参。
 *
 * 用计算属性写 `__proto__` 会落成自有数据属性（对象字面量的 `__proto__` 冒号写法才会
 * 改原型），因此字段名来自数据时也不会污染草稿层。
 * @param touched - 当前草稿层
 * @param field - 字段名
 * @param value - 该格的新值
 * @returns 新的草稿层
 */
export function withDraftField(
  touched: Readonly<Record<string, unknown>>,
  field: string,
  value: unknown,
): Record<string, unknown> {
  return { ...touched, [field]: value };
}

/**
 * 草稿优先、快照兜底：`Object.hasOwn(touched, field)` 为真时取草稿，否则取快照。
 *
 * 显式写 `undefined` 的草稿也会命中自有键，因此「用户清空」不会被快照值盖回去；
 * 这正是与 `diffTouched` 的 `undefined ≡ 缺失` 相反的一侧，两者配合才是完整语义。
 * @param touched - 当前草稿层
 * @param value - 官方快照
 * @param field - 字段名
 * @returns 该格当前应显示的值
 */
export function effectiveField(
  touched: Readonly<Record<string, unknown>>,
  value: object,
  field: string,
): unknown {
  return Object.hasOwn(touched, field) ? touched[field] : Reflect.get(value, field);
}
