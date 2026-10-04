// lib/record.ts —— unknown → Record 的窄化判据与单字段投影。
//
// 为什么值得单点定义：本仓实测 `isRecord` 37 处定义（31 处逐字同形、6 处只是
// `&&` 操作数换序——三个子句都是无副作用的类型/相等判定，`&&` 可交换故同余）、`fieldOf`
// 13 处全部逐字同形，满足 README「同一份样板在两处以上逐字同构地重复才收敛进来」的判据。
// 领域判定（例：某包「缺字段即视为该卡不存在」）不在本文件，留在各插件。

/** 对象类型守卫：非 `null` 的 `object` 且非数组（`Record` 索引签名投影的基础）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从 `unknown` 投影单个字段；非 `Record` → `undefined`。
 *
 * ⚠ **取值走原型链，这是承重的，不是疏忽**：`value[key]` 不做 `hasOwn` 判定，所以原型上的
 * 方法照样取得到。消费方正靠这一条做**能力探测**——cordis 服务对象的方法挂在原型上、不是
 * 自有键，形如 `typeof fieldOf(settings, "describe") === "function"`、
 * `hasMethods(fieldOf(value, "timer"), ["timeout"])`、`typeof fieldOf(session,
 * "snapshotEvents") === "function"`（三处消费包的调用点与行号记在 test/record.test.ts）。
 * 改成 `Object.hasOwn` 会让上面几处**一律判否**，那些包随即认不出合法的 cordis 服务——
 * 而这类误判的表现是「能力探测静默返回 false」，不是报错，极难往这里归因。
 *
 * 代价是明写在这里：键名取到的是原型成员时（`fieldOf({}, "__proto__")` 交回
 * `Object.prototype`、`fieldOf({}, "constructor")` 交回 `Object`）。这是本函数的取舍，
 * 不是让消费方猜的属性——现存调用点的键名全是字面量，没有一处来自数据。
 * test/record.test.ts 两侧都钉住了：原型方法取得到（承重面），自有键优先于原型键。
 *
 * ⚠ 本段刻意不点名兄弟包：**声明上的 JSDoc 会被 tsc 抄进 dist/types/record.d.ts 一起
 * 发出去**，包名会让装了这个包的消费方以为存在一个并不存在的依赖
 *（test/publish-manifest.test.ts 的产物面判据会红）。要写具体调用点就写在 test/ 里。
 */
export function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
