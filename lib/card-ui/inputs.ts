/// <reference lib="dom" />
import { createElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Field } from "./field.ts";
import type { FieldBase } from "./field.ts";

/** 开关行。 */
export function ToggleField(
  props: FieldBase & { checked: boolean; onChange: (next: boolean) => void },
): ReactElement {
  const controlId = useId();
  const describedBy = props.hint === undefined ? undefined : `${controlId}-hint`;
  return createElement(
    Field,
    { ...props, controlId },
    createElement(
      "button",
      {
        type: "button",
        role: "switch",
        id: controlId,
        className: "dsu-switch",
        "aria-checked": props.checked,
        "aria-describedby": describedBy,
        "data-field": props.field,
        disabled: props.disabled === true,
        onClick: () => {
          props.onChange(!props.checked);
        },
      },
      createElement("span", { className: "dsu-knob" }),
    ),
  );
}

/** 数字行：以显示单位读写，越界值不写入，失焦后才提示。 */
export function NumberField(
  props: FieldBase & {
    value: number | undefined;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    placeholder?: string;
    invalidHint: string;
    /**
     * 越界状态变化的通知。父卡片用它把「有字段非法」纳入保存门禁：
     * 越界草稿不会进入 `onChange`，只看草稿变化的话，保存会在有非法字段时照样提交别的字段。
     */
    onInvalidChange?: (invalid: boolean) => void;
    /**
     * 外部重置信号。保存/撤销后父卡片自增一次，把越界草稿与错误清回已提交值；
     * 没有它，父值没变时 `useEffect` 的「保留输入中的草稿」分支会把非法值一直留在框里。
     */
    resetToken?: number;
    onChange: (next: number | undefined) => void;
  },
): ReactElement {
  const text =
    typeof props.value === "number" && Number.isFinite(props.value) ? String(props.value) : "";
  const [draft, setDraft] = useState(text);
  const [invalid, setInvalid] = useState(false);
  const [showInvalid, setShowInvalid] = useState(false);
  // 聚焦标记：与 TextField/ListField 同一条契约——聚焦中不采纳外部值，失焦后草稿跟随父值。
  const [focused, setFocused] = useState(false);
  const lastEmitted = useRef<number | undefined>(undefined);
  const resetSeen = useRef(props.resetToken);
  const onInvalidChange = useRef(props.onInvalidChange);
  const controlId = useId();
  const errorId = useId();
  const hintId = props.hint === undefined ? undefined : `${controlId}-hint`;
  const showError = invalid && showInvalid;
  const describedByIds = [hintId, showError ? errorId : undefined].filter(
    (entry): entry is string => entry !== undefined,
  );
  const describedBy = describedByIds.length === 0 ? undefined : describedByIds.join(" ");

  useEffect(() => {
    onInvalidChange.current = props.onInvalidChange;
  }, [props.onInvalidChange]);

  useEffect(() => {
    onInvalidChange.current?.(invalid);
  }, [invalid]);

  useEffect(() => {
    if (resetSeen.current === props.resetToken) {
      return;
    }
    resetSeen.current = props.resetToken;
    lastEmitted.current = props.value;
    setDraft(text);
    setInvalid(false);
    setShowInvalid(false);
  }, [props.resetToken, props.value, text]);

  useEffect(() => {
    // 本次输入已经把这个值写给父组件；父组件回写同值时保留草稿，
    // 否则 "1." / "01" 会在输入过程中被 String(value) 立刻改写。
    if (props.value === lastEmitted.current) {
      return;
    }
    // 聚焦中不采纳外部值：父层快照在输入中途被外部刷新（另一客户端/宿主推送）时，
    // 不能把正在输入的草稿覆盖掉——尤其越界草稿不会发射 onChange，父值与草稿本就脱节。
    // 失焦后跟随父值，与未聚焦字段的受控语义一致。
    if (focused) {
      return;
    }
    lastEmitted.current = props.value;
    setDraft(text);
    setInvalid(false);
    setShowInvalid(false);
  }, [props.value, text, focused]);

  const accepts = (value: number): boolean => {
    const min = props.min ?? -Infinity;
    const max = props.max ?? Infinity;
    if (!Number.isFinite(value) || value < min || value > max) {
      return false;
    }
    const { step } = props;
    if (step === undefined || step <= 0) {
      return true;
    }
    const base = props.min ?? 0;
    const offset = (value - base) / step;
    return Math.abs(offset - Math.round(offset)) < 1e-9;
  };

  const change = (next: string): void => {
    // 输入过程中只清错误，不提前报错；越界/不合步长在失焦时再展示（forms 指南的校验时机）。
    setShowInvalid(false);
    setDraft(next);
    if (next === "") {
      setInvalid(false);
      lastEmitted.current = undefined;
      props.onChange(undefined);
      return;
    }
    const value = Number(next);
    if (accepts(value)) {
      setInvalid(false);
      lastEmitted.current = value;
      props.onChange(value);
      return;
    }
    setInvalid(true);
  };

  const normalize = (): void => {
    // 空串与越界草稿保持原样；走到这里的 draft 一定能解析成有限数。
    if (draft === "" || invalid) {
      return;
    }
    setDraft(String(Number(draft)));
  };

  const blur = (): void => {
    setShowInvalid(invalid);
    normalize();
  };

  return createElement(
    Field,
    { ...props, controlId },
    createElement(
      "div",
      { className: "dsu-numberWrap" },
      createElement(
        "div",
        { className: "dsu-number" },
        createElement("input", {
          className: props.unit === undefined ? "dsu-input" : "dsu-input dsu-inputWithUnit",
          type: "number",
          inputMode: "numeric",
          id: controlId,
          value: draft,
          min: props.min,
          max: props.max,
          step: props.step,
          placeholder: props.placeholder,
          "aria-invalid": showError || undefined,
          "aria-describedby": describedBy,
          "data-field": props.field,
          disabled: props.disabled === true,
          onChange: (event: { target: { value: string } }) => {
            change(event.target.value);
          },
          onFocus: () => {
            setFocused(true);
          },
          onBlur: () => {
            setFocused(false);
            blur();
          },
        }),
        props.unit === undefined
          ? null
          : createElement("span", { className: "dsu-unit" }, props.unit),
      ),
      showError
        ? createElement("p", { className: "dsu-error", id: errorId }, props.invalidHint)
        : null,
    ),
  );
}

/** 单行/多行文本。 */
export function TextField(
  props: FieldBase & {
    value: string;
    placeholder?: string;
    multiline?: boolean;
    monospace?: boolean;
    onChange: (next: string) => void;
  },
): ReactElement {
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);
  const controlId = useId();
  const describedBy = props.hint === undefined ? undefined : `${controlId}-hint`;

  useEffect(() => {
    if (!focused) {
      setDraft(props.value);
    }
  }, [props.value, focused]);

  const className = `dsu-input${props.multiline === true ? " dsu-textarea" : ""}${
    props.monospace === true ? " dsu-mono" : ""
  }`;
  const shared = {
    id: controlId,
    className,
    value: draft,
    placeholder: props.placeholder,
    "aria-describedby": describedBy,
    "data-field": props.field,
    disabled: props.disabled === true,
    onFocus: () => {
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
    },
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      props.onChange(event.target.value);
    },
  };

  return createElement(
    Field,
    { ...props, controlId },
    props.multiline === true ? createElement("textarea", shared) : createElement("input", shared),
  );
}

/** 名单行：逗号或换行分隔。逗号形态不支持条目本身含逗号；自由文本与正则用 newline。 */
export function ListField(
  props: FieldBase & {
    value: readonly string[];
    separator?: "comma" | "newline";
    placeholder?: string;
    onChange: (next: string[]) => void;
  },
): ReactElement {
  const separator = props.separator ?? "comma";
  const joined = props.value.join(separator === "newline" ? "\n" : ", ");
  const [draft, setDraft] = useState(joined);
  const [focused, setFocused] = useState(false);
  const controlId = useId();
  const describedBy = props.hint === undefined ? undefined : `${controlId}-hint`;

  useEffect(() => {
    if (!focused) {
      setDraft(joined);
    }
  }, [joined, focused]);

  const split = (raw: string): string[] =>
    raw
      .split(separator === "newline" ? "\n" : ",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const className = `dsu-input${separator === "newline" ? " dsu-textarea dsu-mono" : ""}`;
  const shared = {
    id: controlId,
    className,
    value: draft,
    placeholder: props.placeholder,
    "aria-describedby": describedBy,
    "data-field": props.field,
    disabled: props.disabled === true,
    onFocus: () => {
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
    },
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      props.onChange(split(event.target.value));
    },
  };

  return createElement(
    Field,
    { ...props, controlId },
    separator === "newline" ? createElement("textarea", shared) : createElement("input", shared),
  );
}
