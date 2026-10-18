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
 * touched 层与快照的差异字段（值语义比较；undefined、null 与缺失三者等价）。
 *
 * 用 `JSON.stringify` 而不是 `===` 比较：设置项的值是表单里的标量与数组，引用相等会把
 * 「用户重排了同内容的数组」判成改动，也会把两份等值数组判成没改。
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
    if (JSON.stringify(touched[key] ?? null) !== JSON.stringify(value[key] ?? null)) {
      out.push(key);
    }
  }
  return out;
}
