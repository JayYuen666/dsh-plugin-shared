import { useCallback, useState } from "react";

/**
 * 越界字段集的一次变更 —— 设置卡「有字段越界就不许保存」那道门禁的共享实现。
 *
 * 为什么需要单独记一份「哪些字段现在越界」：`NumberField` 对越界草稿**不调 `onChange`**
 * （越界值不该进草稿，否则会被当成用户想写进去的值），于是它根本不进 `touched`。只看
 * 「草稿 vs 已提交值」的保存门禁因此会认为「什么都没改」，用户点保存时其余字段被写出去、
 * 越界那一格静默丢掉 —— 卡片上没有任何提示，配置却少了一格。
 *
 * 各仓的卡片各持一份 `ReadonlySet<string>` 状态，把 `NumberField` 的 `onInvalidChange`
 * 原样转给下面的函数即可；保存条文案用各仓自己的 `invalidFields` 键（本模块不管文案）。
 * 这套状态机本身由下文的 `useInvalidFields()` 一并给出，各卡不必再各写一遍。
 *
 * 与 `NumberField` 的另外两位是一套：`onInvalidChange` 负责把状态报上来，
 * `resetToken` 负责在保存/撤销后把框里的非法草稿清回已提交值（父值没变时组件内
 * 「保留输入中的草稿」那一支会把非法值一直留在框里）。
 *
 * @param prev - 当前越界字段集（卡片 state 里的那一份）
 * @param field - 状态变化的那一格（与 `NumberField` 的 `field` 同名）
 * @param invalid - 这一格现在是否越界
 * @returns 新的字段集；状态没变时**原样返回传入的那一枚**（React 靠引用相等跳过重渲）
 */
export function withInvalidField(
  prev: ReadonlySet<string>,
  field: string,
  invalid: boolean,
): ReadonlySet<string> {
  if (prev.has(field) === invalid) {
    return prev;
  }
  const next = new Set(prev);
  if (invalid) {
    next.add(field);
  } else {
    next.delete(field);
  }
  return next;
}

/** 一张卡的越界状态与它的出口（`useInvalidFields()` 的返回值）。 */
export interface InvalidFields {
  /** 有字段越界：越界草稿这次提交会静默丢掉，所以整张卡不给保存。 */
  blocked: boolean;
  /** 保存/撤销后自增一次，把数字框里的越界草稿清回已提交值。 */
  resetToken: number;
  /** 现在越界的字段名（只读视图）：需要与 `touched` 去重计数时用它，别用 `count` 相加。 */
  fields: ReadonlySet<string>;
  /** 现在越界了几格：`fields.size` 的便捷写法。 */
  count: number;
  /** 数字框把「本字段现在越界」上报进来。 */
  reportInvalid: (field: string, invalid: boolean) => void;
  /** 保存受理、撤销之后调用：清掉越界集并推进一次重置信号。 */
  clear: () => void;
}

/**
 * 一张卡的越界状态机：`NumberField` 的 `onInvalidChange` 接 `reportInvalid`，
 * 保存/撤销后调一次 `clear`，把 `blocked` 与 `resetToken` 交给保存条与每个数字框。
 *
 * 这套状态（越界集 + 重置信号 + 清空）在每张带数字字段的卡上都一模一样，收在这里而不是
 * 让各卡各写一遍：漏掉 `clear` 的症状是保存后红框还在，漏掉 `resetToken` 的透传是撤销后
 * 非法值仍留在框里，两者都是「看起来保存成功了但还在报错」。
 *
 * @returns 状态与两个出口；返回值在一轮渲染内稳定（除清空外不改引用）
 */
export function useInvalidFields(): InvalidFields {
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(() => new Set());
  const [resetToken, setResetToken] = useState(0);
  // 两个出口都定住引用：它们会被透传到每个 `NumberField` 的 `onInvalidChange`，引用每轮都变
  // 会让那个转发 `useEffect` 在每次重渲时白跑一遍（行为不变，但整张卡打字时白白重排）。
  const reportInvalid = useCallback((field: string, invalid: boolean): void => {
    setInvalidFields((prev) => withInvalidField(prev, field, invalid));
  }, []);
  const clear = useCallback((): void => {
    setInvalidFields(new Set());
    setResetToken((current) => current + 1);
  }, []);
  return {
    blocked: invalidFields.size > 0,
    fields: invalidFields,
    count: invalidFields.size,
    resetToken,
    reportInvalid,
    clear,
  };
}
