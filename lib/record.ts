// lib/record.ts —— unknown → Record 的窄化判断与单字段投影。
//
// 为什么值得单点定义：`isRecord` 与 `fieldOf` 在各包里原本是逐字相同的重复定义
// （`&&` 操作数换序的那几处与它们同余——三个子句都是无副作用的类型/相等判定），
// 满足 README「同一份样板在两处以上逐字相同地重复才收录进来」的标准。
// 领域判定（例：某包「缺字段即视为该卡不存在」）不在本文件，留在各插件。

/**
 * 数组守卫：撤销后的 Proxy 上 `Array.isArray` 会抛 TypeError，按「不是数组」处理。
 *
 * 这是 `isRecord` 的配套值守卫：AST 遍历、require 调用收集与前端载荷投影都需要同一份
 * 「数组 vs 记录」判定，不能一处用裸 `Array.isArray`、另一处用 `instanceof`。
 * @param value - 待判定的值
 * @returns 是否为数组
 */
export function isArrayValue(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    // Proxy.revocable 撤销后 typeof 仍是 object，但 Array.isArray 会抛 TypeError。
    return false;
  }
}

/**
 * 未知值 → 数组：非数组一律空表，且不把撤销 Proxy 的异常抛穿。
 *
 * 这是 `unknownArray` 一族（四个消费仓各一份）的唯一实现。
 * 与 `isArrayValue` 的分工：那个回答「是不是数组」，这个回答「不是数组时拿什么继续读」。
 * @param value - 待判定的值
 * @returns 原数组（只读视图），或空表
 */
export function arrayOf(value: unknown): readonly unknown[] {
  return isArrayValue(value) ? value : [];
}

/**
 * 宽口径对象守卫：非 `null`、`typeof object` 且非数组。
 *
 * 它回答的是「能否按 `Record<string, unknown>` 索引读取」，不是「是不是服务」：
 * `Date` / `Map` / 类实例也会通过，函数不会通过。需要能力检查时用 {@link hasMethods}。
 *
 * 刻意不复用 {@link isArrayValue}：后者把撤销后的 Proxy 折成「不是数组」，而本函数需要把
 * 同一个异常折成「不可索引」；若直接取反会得到一个能骗过能力检查的撤销 Proxy。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    return !Array.isArray(value);
  } catch {
    // Proxy.revocable 撤销后 typeof 仍是 object，但 Array.isArray 会抛 TypeError。
    return false;
  }
}

/** 读取抛错（恶意 getter / Proxy 的 get trap）时的共同结局：按「该成员取不到」处理。 */
function readMember(value: Record<string, unknown>, key: string): unknown {
  let member: unknown;
  try {
    member = value[key];
  } catch {
    member = undefined;
  }
  return member;
}

/**
 * 服务可用性校验：对象存在，且**本次读取到的每个声明成员都是函数**，同时不是
 * `Object.prototype` 的默认成员。
 *
 * 这是启发式检查，不是可调用性保证：类构造器也是 `function`，直接调用却会抛错；
 * getter 下一次读取可能变成别的值；getter / Proxy trap 执行时也可能有副作用。
 * 它不做试调用，也不承诺“检查通过后调用一定成功”。
 *
 * 空清单不证明任何能力，返回 `false`；只判断「是不是对象」请用 {@link isRecord}。
 *
 * `Object.prototype` 的默认成员不算服务实现：`hasMethods({}, ["toString"])` 若照单全收，
 * 一个普通对象就能冒充服务。判断是**身份**——解析到的函数正是 `Object.prototype` 上
 * 那一个才排除，所以类/中间原型上的真实实现（包括对原型成员的重写）照常可识别，
 * cordis 方法挂在原型上的读取不受影响。
 * @param value 待验证的服务候选（来自 `ctx.get(...)` 的 unknown）
 * @param methods 该服务必须读到的函数成员名
 * @returns 本次检查是否通过
 */
export function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (!isRecord(value) || methods.length === 0) {
    return false;
  }
  for (const method of methods) {
    const member = readMember(value, method);
    if (typeof member !== "function") {
      return false;
    }
    // Object.prototype 的成员都是自有属性（它的原型是 null），descriptor 的 value 位即成员本身。
    if (member === Object.getOwnPropertyDescriptor(Object.prototype, method)?.value) {
      return false;
    }
  }
  return true;
}

/**
 * 可选服务能力校验：每个声明成员要么缺席，要么是函数；`Object.prototype` 的默认成员不算。
 *
 * 与 {@link hasMethods} 的分工：那个要求每个成员**必须**存在（缺一位就 false），这个允许
 * 成员缺席。工作目录服务、`ctx.get("remote")` 这类「服务可能只装了一半」的读取面用这一版；
 * 缺席交给调用方的值守卫（`service.get?.(...)`）回落，而不是在守卫里判死。
 *
 * 空清单仍返回 `false`：一份没有声明任何能力的清单不证明任何东西，与 `hasMethods` 同一条
 * 口径。`get` 这类名字不在 `Object.prototype` 上，原型成员排除对它们无影响；保留这一段是
 * 为了 `hasOptionalMethods({}, ["toString"])` 不被普通对象冒充。
 * @param value 待验证的服务候选
 * @param methods 允许缺席、但出现时必须是函数的成员名
 * @returns 本次检查是否通过
 */
export function hasOptionalMethods(value: unknown, methods: readonly string[]): boolean {
  if (!isRecord(value) || methods.length === 0) {
    return false;
  }
  for (const method of methods) {
    const member = readMember(value, method);
    if (member !== undefined) {
      if (typeof member !== "function") {
        return false;
      }
      if (member === Object.getOwnPropertyDescriptor(Object.prototype, method)?.value) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 从 `unknown` 投影单个字段；非 `Record` → `undefined`。
 *
 * 读取走原型链（自有键优先）：这是能力检查所需的契约，cordis 服务对象的方法挂在原型上，
 * 不是自有键。读取抛错（恶意 getter / Proxy trap）按「取不到」返回 `undefined`，异常不冒泡。
 *
 * 代价也是契约的一部分：键名为 `__proto__` / `constructor` 时会读到原型成员
 *（`fieldOf({}, "__proto__")` 交回 `Object.prototype`、`fieldOf({}, "constructor")` 交回 `Object`）。
 * 键名来自数据时，调用方应自行限制可接受的键。
 */
export function fieldOf(value: unknown, key: string): unknown {
  // 设计理由只留在源码：value[key] 刻意不做 hasOwn 判定，否则 cordis 服务原型上的方法
  // 会一律判否；具体消费点与回归在 test/record.test.ts。这个注释不应进入 .d.ts。
  return isRecord(value) ? readMember(value, key) : undefined;
}
