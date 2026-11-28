// card-ui/draft：设置卡的草稿层状态机。
//
// 每张带表单的设置卡都在写同一段：`touched` 记录用户改过的字段、`eff` 让输入框优先读
// 草稿、`setField` 写入、`discard` 清空并把越界红框一起复位。七份逐字副本的差别只有
// 「值要不要先过 schema 收窄」与「清空时要不要顺带清错误条」两处，因此收成一个 hook，
// 两处差异走 options，而不是让每个仓各留一份。
//
// 越界集与重置信号仍由 `useInvalidFields()` 提供：那套状态机（`clear` 同时推进
// `resetToken`）是 `NumberField` 的配套契约，不在这里重造。
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { effectiveField } from "../card-form.ts";
import { diffTouched } from "../card-diff.ts";
import { useInvalidFields } from "./invalid.ts";
import type { InvalidFields } from "./invalid.ts";

/** `useCardDraft` 的两处仓间差异。 */
export interface CardDraftOptions {
  /** 读草稿值时先过的收窄（例如 zod `safeParse`）；不传时原样返回。 */
  readonly parseField?: (field: string, value: unknown) => unknown;
  /** `discard` 的额外清理（各卡用来清自己的 `saveError`）。 */
  readonly onDiscard?: () => void;
}

/** 一张设置卡的草稿层。 */
export interface CardDraft<Draft extends Record<string, unknown> = Record<string, unknown>> {
  readonly touched: Draft;
  readonly setTouched: Dispatch<SetStateAction<Draft>>;
  /** 渲染值：草稿优先，未改过的字段实时跟随外部快照。 */
  readonly eff: (field: string) => unknown;
  readonly setField: (field: string, value: unknown) => void;
  /** 清空该字段（写入 `undefined` 表示 unset；`diffTouched` 视为未改，但 `eff` 仍优先返回这个显式值；只有 `discard` 才回到快照）。 */
  readonly clearField: (field: string) => void;
  /** 丢弃全部草稿：清 touched、清越界集、推进 `resetToken`，再跑 `onDiscard`。 */
  readonly discard: () => void;
  readonly invalid: InvalidFields;
  /** `touched` 与快照的差异键（不含越界字段）。 */
  readonly dirtyKeys: readonly string[];
  /** 保存条计数：差异键 ∪ 越界字段，按字段去重。 */
  readonly pendingCount: number;
}

/**
 * 空草稿：无键对象是任何 `Record` 形状的合法起点，运行期没有额外字段。
 * 泛型只服务于调用方对字段值域的收窄标注，这一处断言因此集中在工厂里。
 * @returns 一枚空草稿
 */
function emptyDraft<Draft extends Record<string, unknown>>(seed?: Draft): Draft {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 空对象对任何 Record 形状都是合法起点
  return seed ?? ({} as Draft);
}

/**
 * 设置卡草稿层。
 *
 * @param value - 当前已提交快照（`touched` 未命中的字段从这里读）
 * @param options - 收窄函数与丢弃时的额外清理
 * @returns 草稿状态、派生值与三个出口
 */
export function useCardDraft<Draft extends Record<string, unknown> = Record<string, unknown>>(
  value: object,
  options: CardDraftOptions = {},
): CardDraft<Draft> {
  // 直接传初值而不是惰性初始化函数：各包的卡片测试把 `useState` 桩成「初始值即渲染值」，
  // 桩不会替我们调用函数初值；这里的空对象构造成本可以忽略，不值得让各包测试替身都改。
  const [touched, setTouched] = useState<Draft>(emptyDraft<Draft>());
  const invalid = useInvalidFields();
  const { parseField, onDiscard } = options;
  const eff = useCallback(
    (field: string): unknown => {
      if (parseField === undefined) {
        return effectiveField(touched, value, field);
      }
      if (!Object.hasOwn(touched, field)) {
        return Reflect.get(value, field);
      }
      return parseField(field, touched[field]);
    },
    [touched, value, parseField],
  );
  const { clear: clearInvalid, fields: invalidFields } = invalid;
  const setField = useCallback((field: string, next: unknown): void => {
    setTouched((prev) => ({ ...prev, [field]: next }));
  }, []);
  const clearField = useCallback((field: string): void => {
    setTouched((prev) => ({ ...prev, [field]: undefined }));
  }, []);
  const discard = useCallback((): void => {
    // 空草稿就是一枚无键对象；`Draft` 只是调用方对值的收窄标注，运行期没有额外字段。
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 空对象对任何 Record 形状都是合法起点
    setTouched({} as Draft);
    clearInvalid();
    onDiscard?.();
  }, [clearInvalid, onDiscard]);
  const dirtyKeys = diffTouched(touched, value);
  const pendingCount = new Set([...dirtyKeys, ...invalidFields]).size;
  return {
    touched,
    setTouched,
    eff,
    setField,
    clearField,
    discard,
    invalid,
    dirtyKeys,
    pendingCount,
  };
}
