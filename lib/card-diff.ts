// lib/card-diff.ts —— 卡片草稿层（touched）与官方快照之间的差异投影。
//
// 为什么收进来：同一份「touched 层里哪些字段真的改了」的判断在各包客户端里原本是逐字相同的
// 重复定义（连注释一起相同），满足 README「同一份样板在两处以上逐字相同地重复才收录进来」的
// 标准；散着写的话，各包对「undefined 与缺失是否算改动」迟早会各漂成一个说法。
//
// 刻意不收的那一个：各包的 `cardStore`（把官方 configForm 快照适配成
// `useSyncExternalStore` 的记忆化壳）。它看着相似，实测六份**函数体互不相同**（缓存的投影字段、
// 空快照的形态、失效条件都随包而异），合并即改行为，留在各包。

/** 一个待比较的左右配对。 */
type ValuePair = [left: unknown, right: unknown];

/** 左节点 → 已与它比较过的右节点集合。 */
type PairMemo = WeakMap<object, WeakSet<object>>;

/**
 * 表单值域里的普通记录：JSON 对象与 null 原型对象。
 *
 * Date、Map、Set、RegExp、包装原始值等内建对象不在这个域里——它们的内部槽不在
 * `Object.keys` 里，只按「自有键」比较会把内容不同的两个 Date/Map 静默判成相等。
 * 值域外的对象只承认同一引用（`Object.is` 已在前面处理），不同实例一律算改动。
 * @param value - 待判定的对象
 * @returns 是否是普通记录
 */
function isPlainRecord(value: object): boolean {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 空值判据：`null` 与 `undefined` 在任意层级等价，但不用 `== null`（基线的 eqeqeq 不接受）。
 * @param value - 待判定的值
 * @returns 是否为 null 或 undefined
 */
function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * 把一对值转成「相等 / 不等 / 已排入子任务」。
 *
 * 对象与数组共用一条键并集路径：两侧都只取自有可枚举字符串键，缺失一侧按 undefined。
 * 数组另外比长度；空洞天然不在 `Object.keys` 里，读取时得到 undefined，于是「空洞」与
 * 「显式 undefined」等价。`Object.keys` 只看真实存在的键，`new Array(1e9)` 这种稀疏数组
 * 不会按 length 逐格遍历。
 *
 * 循环引用按完整左右配对剪枝：单键 `WeakMap<object, object>` 只能记住一个右节点，
 * 左节点是单节点环、右节点是双节点环时旧配对会被不断覆盖，比较永远不重复。
 * @param left - 左值
 * @param right - 右值
 * @param pending - 待比较队列
 * @param seen - 配对表
 * @returns true 表示相等或子任务已排入；false 表示已经判出不等
 */
function enqueuePair(left: unknown, right: unknown, pending: ValuePair[], seen: PairMemo): boolean {
  // 任意层级：null / undefined / 缺失三者等价（两边都用 isNullish 折叠）。
  if (isNullish(left)) {
    return isNullish(right);
  }
  if (isNullish(right)) {
    return false;
  }
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
  } else if (!isPlainRecord(left) || !isPlainRecord(right)) {
    // 普通记录之外的实例不在表单值域内：只承认同一引用（上面的 Object.is 已处理）。
    return false;
  }

  // 完整左右配对：单键 WeakMap 只记一个右节点，单节点环对多节点环会无限比较。
  let rights = seen.get(left);
  if (rights === undefined) {
    rights = new WeakSet<object>();
    seen.set(left, rights);
  }
  if (rights.has(right)) {
    return true;
  }
  rights.add(right);

  const leftKeys = new Set(Object.keys(left));
  const rightKeys = new Set(Object.keys(right));
  for (const key of new Set([...leftKeys, ...rightKeys])) {
    pending.push([
      leftKeys.has(key) ? Reflect.get(left, key) : undefined,
      rightKeys.has(key) ? Reflect.get(right, key) : undefined,
    ]);
  }
  return true;
}

/**
 * 两个表单值是否相等（带配对表的内部实现）。
 *
 * 语义见下方公开的 {@link formValueEquals}；`seen` 由调用方提供，`diffTouched` 为每个字段
 * 各造一份，公开入口为每次比较造一份。
 * @param left - 一侧的值
 * @param right - 另一侧的值
 * @param seen - 本次比较的「左 → 右」配对表，用于在循环引用上正常结束
 * @returns 是否相等
 */
function equalsWith(left: unknown, right: unknown, seen: PairMemo): boolean {
  const pending: ValuePair[] = [[left, right]];
  // 数组迭代器按 length 动态取值：循环体里 push 的子任务会在同一轮继续被消费。
  for (const pair of pending) {
    if (!enqueuePair(pair[0], pair[1], pending, seen)) {
      return false;
    }
  }
  return true;
}

/**
 * 两个表单值是否相等（公开入口）。
 *
 * 语义：
 * - `null`、`undefined` 与缺失在**任意层级**等价；
 * - 对象与数组都比自有可枚举字符串键的**并集**，缺失一侧按 `undefined`；
 * - 数组另外比长度，空洞按 `undefined`（于是空洞与显式 `undefined` 等价）；
 * - 其余原始值走 `Object.is`（`NaN` 与 `NaN` 相等，`-0` 与 `0` 不等）；
 * - 循环引用按完整左右配对剪枝，同一对重复出现时按已比过处理。
 *
 * 与 `JSON.stringify` 的差异就是本函数存在的理由：键序不影响判定；`NaN` 与 `null` 不等价；
 * BigInt 与循环引用不抛。反过来也要记住 `-0` 与 `0` 在本函数里**不等**，而序列化会把它们
 * 判成相同——替换旧比较时若值域里可能出现 `-0`，要显式钉一条用例。
 * @param left - 一侧的值
 * @param right - 另一侧的值
 * @returns 是否相等
 */
export function formValueEquals(left: unknown, right: unknown): boolean {
  return equalsWith(left, right, new WeakMap<object, WeakSet<object>>());
}

/**
 * touched 层与快照的差异字段（值语义比较；undefined、null 与缺失三者等价）。
 *
 * 比较用 {@link formValueEquals} 而不是 `===` 或 `JSON.stringify`：引用相等会把「用户重排了
 * 同内容的数组」判成改动，而序列化比较会在 NaN、键序、BigInt 与循环引用上给出错误答案。
 *
 * 快照只读**自有可枚举**字段：原型链上的同名成员（`toString` / `constructor` 等）不是快照值。
 * touched 里有、快照里没有的字段按缺失处理，而不是去读原型。
 * @param touched 草稿层里被碰过的字段
 * @param value 官方快照里的当前值
 * @returns 真正发生改动的字段名，顺序随 `touched` 的键序
 */
export function diffTouched(touched: Record<string, unknown>, value: object): string[] {
  const out: string[] = [];
  const snapshotKeys = new Set(Object.keys(value));
  for (const key of Object.keys(touched)) {
    // 每个字段一份新的 seen：seen 只在「同一次比较的下钻路径上」代表「这两个节点已经在
    // 比较中」，它不记录结论。跨字段复用会把某字段里比过却不等的配对当成已比过，下一次
    // 直接返回相等——一次假阴性。
    const snapshotValue: unknown = snapshotKeys.has(key) ? Reflect.get(value, key) : undefined;
    if (!equalsWith(touched[key], snapshotValue, new WeakMap<object, WeakSet<object>>())) {
      out.push(key);
    }
  }
  return out;
}
