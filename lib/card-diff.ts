// lib/card-diff.ts —— 卡片草稿层（touched）与官方快照之间的差异投影。
//
// 为什么收进来：同一份「touched 层里哪些字段真的改了」的判据在各包客户端里原本是逐字同构的
// 重复定义（连注释一起相同），满足 README「同一份样板在两处以上逐字同构地重复才收敛进来」的
// 判据；散着写的话，各包对「undefined 与缺失是否算改动」迟早会各漂成一个说法。
//
// 刻意不收的那一件：各包的 `cardStore`（把官方 configForm 快照适配成
// `useSyncExternalStore` 的记忆化壳）。它看着同构，实测六份**函数体互不相同**（缓存的投影字段、
// 空快照的形状、失效条件都随包而异），合并即改行为，留在各包。

/**
 * 两个值按「表单语义」是否相等：null、undefined 与缺失等价；对象比键集与每个值，
 * 数组比长度与每个元素；其余走 `Object.is`（于是 NaN 与 NaN 相等，`-0` 与 `0` 不等）。
 *
 * 不用 `JSON.stringify` 比较：它把 `NaN`/`Infinity` 都渲染成 `"null"`（`{a:NaN}` 与
 * `{a:null}` 会被判成没改），把 `BigInt` 与循环引用直接抛 `TypeError`，而对象的键序
 * 又会把「同内容的两个对象」判成改动——三个方向都错，且错得不报错。
 * @param left - 一侧的值
 * @param right - 另一侧的值
 * @param seen - 已访问过的「左 → 右」配对，用于在循环引用上收敛
 * @returns 是否相等
 */
function formValueEquals(left: unknown, right: unknown, seen: WeakMap<object, object>): boolean {
  // null / undefined / 缺失三者等价：表单里「没填」与「填了空」是同一件事。
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  // 循环引用：同一对节点第二次出现时按「已比过」处理。没有这一支会无限下钻直到爆栈，
  // 而爆栈是从这里抛出去的 RangeError——调用方（客户端渲染路径）没有 try/catch。
  const paired = seen.get(left);
  if (paired === right) {
    return true;
  }
  seen.set(left, right);
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => formValueEquals(item, right[index], seen));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  // 用 Reflect.get 而不是下标读：这里两侧都只收窄到 object，
  // 下标读要写 `as Record<string, unknown>` 而本仓 lint 禁这种收窄断言。
  return leftKeys.every(
    (key) =>
      Object.hasOwn(right, key) &&
      formValueEquals(Reflect.get(left, key), Reflect.get(right, key), seen),
  );
}

/**
 * touched 层与快照的差异字段（值语义比较；undefined、null 与缺失三者等价）。
 *
 * 比较用 {@link formValueEquals} 而不是 `===` 或 `JSON.stringify`：引用相等会把「用户重排了
 * 同内容的数组」判成改动，而序列化比较会在 NaN、键序、BigInt 与循环引用上给出错误答案。
 * @param touched 草稿层里被碰过的字段
 * @param value 官方快照里的当前值
 * @returns 真正发生改动的字段名，顺序随 `touched` 的键序
 */
export function diffTouched(
  touched: Record<string, unknown>,
  value: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(touched)) {
    // 每个字段一份新的 seen：seen 只在「同一次比较的下钻路径上」代表「这两个节点已经在
    // 比较中」，它不记录结论。跨字段复用会把某字段里比过却不等的配对当成已比过，下一次
    // 直接返回相等——一次假阴性。
    if (!formValueEquals(touched[key], value[key], new WeakMap<object, object>())) {
      out.push(key);
    }
  }
  return out;
}
