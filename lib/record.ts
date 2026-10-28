// lib/record.ts —— unknown → Record 的窄化判断与单字段投影。
//
// 为什么值得单点定义：`isRecord` 与 `fieldOf` 在各包里原本是逐字相同的重复定义
// （`&&` 操作数换序的那几处与它们同余——三个子句都是无副作用的类型/相等判定），
// 满足 README「同一份样板在两处以上逐字相同地重复才收录进来」的标准。
// 领域判定（例：某包「缺字段即视为该卡不存在」）不在本文件，留在各插件。

/** 对象类型守卫：非 `null` 的 `object` 且非数组（`Record` 索引签名投影的基础）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 带保护的成员读取的两种结局：成员值本身可能是任何东西（含 undefined），所以「读到了」与
 * 「读取抛错」必须是可区分的两种形态，不能共用 undefined。
 */
type MemberRead = { readonly absent: true } | { readonly absent: false; readonly value: unknown };

/** 读取抛错（恶意 getter / Proxy 的 get trap）时的共同结局：按「该成员取不到」处理。 */
const ABSENT_READ: MemberRead = { absent: true };

/**
 * 带保护的成员读取。被测对象来自 `ctx.get(...)` 的 unknown，可能带 getter 或 Proxy trap：
 * 读取抛错在出口处变成「取不到」而不是向外冒泡——本文件的两个出口都是能力检查，
 * 一次抛错会让 `typeof fieldOf(x, "describe") === "function"` 这类表达式整体抛错，
 * 把「能力不存在」放大成流程崩溃。
 */
function readMember(value: Record<string, unknown>, key: string): MemberRead {
  try {
    return { absent: false, value: value[key] };
  } catch {
    return ABSENT_READ;
  }
}

/**
 * 服务可用性校验：对象存在且**声明的每个方法**都可调用。
 *
 * 只做 `typeof value["shell"] === "object"` 的话，检查声称的是「有这个服务」而实际证明的只是
 * 「有个对象」——运行到一半才报错。逐个写出方法名，检查才名副其实。
 *
 * `Object.prototype` 的默认成员不算服务实现：`hasMethods({}, ["toString"])` 若照单全收，
 * 一个普通对象就能冒充服务。判断是**身份**——解析到的函数正是 `Object.prototype` 上
 * 那一个才排除，所以类/中间原型上的真实实现（包括对原型成员的重写）照常可识别，
 * cordis 方法挂在原型上的读取不受影响。
 * @param value 待验证的服务候选（来自 `ctx.get(...)` 的 unknown）
 * @param methods 该服务必须可调用的方法名
 * @returns 是否为可用的服务
 */
export function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (!isRecord(value)) {
    return false;
  }
  for (const method of methods) {
    const read = readMember(value, method);
    if (read.absent || typeof read.value !== "function") {
      return false;
    }
    // Object.prototype 的成员都是自有属性（它的原型是 null），descriptor 的 value 位即成员本身。
    if (read.value === Object.getOwnPropertyDescriptor(Object.prototype, method)?.value) {
      return false;
    }
  }
  return true;
}

/**
 * 从 `unknown` 投影单个字段；非 `Record` → `undefined`。
 *
 * ⚠ **取值走原型链，这是有意为之，不是疏忽**：`value[key]` 不做 `hasOwn` 判定，所以原型上的
 * 方法照样取得到。消费方正靠这一条做**能力检查**——cordis 服务对象的方法挂在原型上、不是
 * 自有键，形如 `typeof fieldOf(settings, "describe") === "function"`、
 * `hasMethods(fieldOf(value, "timer"), ["timeout"])`、`typeof fieldOf(session,
 * "snapshotEvents") === "function"`（消费包的调用点记在 test/record.test.ts）。
 * 改成 `Object.hasOwn` 会让上面几处**一律判否**，那些包随即认不出合法的 cordis 服务——
 * 而这类误判的表现是「能力检查静默返回 false」，不是报错，极难往这里归因。
 *
 * 代价是明写在这里：键名取到的是原型成员时（`fieldOf({}, "__proto__")` 交回
 * `Object.prototype`、`fieldOf({}, "constructor")` 交回 `Object`）。这是本函数的取舍，
 * 不是让消费方猜的属性——现存调用点的键名全是字面量，没有一处来自数据。
 * test/record.test.ts 两侧都有用例固定：原型方法取得到（这是关键行为），自有键优先于原型键。
 *
 * ⚠ 本段刻意不写出兄弟包的名字：**声明上的 JSDoc 会被 tsc 抄进 dist/types/record.d.ts 一起
 * 发出去**，包名会让装了这个包的消费方以为存在一个并不存在的依赖
 *（test/publish-manifest.test.ts 的产物检查会判定失败）。要写具体调用点就写在 test/ 里。
 *
 * 读取走的是带保护的出口：被测对象带抛错 getter / Proxy trap 时按「取不到」交回
 * `undefined`，异常不冒泡（能力检查不该打断流程）。
 */
export function fieldOf(value: unknown, key: string): unknown {
  const read = isRecord(value) ? readMember(value, key) : ABSENT_READ;
  return read.absent ? undefined : read.value;
}
