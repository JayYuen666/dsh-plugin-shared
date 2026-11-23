/// <reference lib="dom" />
import { createElement, useEffect, useRef, useState } from "react";
import { nextDomId } from "./ids.ts";
import type { ReactElement, ReactNode } from "react";
import { Field, FieldLabel } from "./field.ts";
import type { FieldBase } from "./field.ts";

const SWITCH_CLASS = "dsu-switch";

/** 开关行。 */
export function ToggleField(
  props: FieldBase & { checked: boolean; onChange: (next: boolean) => void },
): ReactElement {
  const controlId = nextDomId("dsu-field");
  const describedBy =
    props.hint === undefined && props.detail === undefined ? undefined : `${controlId}-hint`;
  const errorId = props.invalidText === undefined ? undefined : `${controlId}-err`;
  const described = [describedBy, errorId].filter((part) => part !== undefined).join(" ");
  return createElement(
    Field,
    { ...props, controlId, layout: props.layout ?? "row" },
    createElement(
      "button",
      {
        type: "button",
        role: "switch",
        id: controlId,
        className: SWITCH_CLASS,
        "aria-checked": props.checked,
        "aria-describedby": described.length === 0 ? undefined : described,
        ...(props.invalidText === undefined
          ? {}
          : { "aria-invalid": true, "aria-errormessage": errorId }),
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

/** 节级开关：只画开关本体，标签由 `aria-label` 承担。放在 `Section` 的 `toggle` 位，
 *  用于“整个小节的总开关”这一类语义；不占字段行。 */
export function SectionToggle(props: {
  field: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}): ReactElement {
  const controlId = nextDomId("dsu-section-toggle");
  return createElement(
    "span",
    { className: "dsu-sectionToggle" },
    createElement("span", { className: "dsu-sectionToggleLabel" }, props.label),
    createElement(
      "button",
      {
        type: "button",
        role: "switch",
        id: controlId,
        className: SWITCH_CLASS,
        "aria-checked": props.checked,
        "aria-label": props.label,
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

/** 成组布尔项的紧凑双列栅格（设计稿 `.toggle-grid`）。 */
export function ToggleGrid(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-toggleGrid" }, props.children);
}

/** 紧凑布尔单元格：标签 + 说明按钮在左，开关在右；用于成组工具开关。 */
export function ToggleCell(
  props: FieldBase & { checked: boolean; onChange: (next: boolean) => void },
): ReactElement {
  const controlId = nextDomId("dsu-field");
  const hintId =
    props.hint === undefined && props.detail === undefined ? undefined : `${controlId}-hint`;
  const errorId = props.invalidText === undefined ? undefined : `${controlId}-err`;
  const tipDetail =
    props.hint === undefined || props.detail === undefined
      ? (props.detail ?? props.hint)
      : `${props.detail} ${props.hint}`;
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ");
  return createElement(
    "div",
    { className: "dsu-toggleCell" },
    createElement(
      "div",
      { className: "dsu-toggleMeta" },
      createElement(FieldLabel, {
        label: props.label,
        detail: tipDetail,
        controlId,
        invalidText: props.invalidText,
      }),
      props.hint === undefined && props.detail === undefined
        ? null
        : createElement(
            "span",
            { className: "dsu-srOnly", id: hintId },
            [props.detail, props.hint].filter((part) => part !== undefined).join(" "),
          ),
      props.invalidText === undefined
        ? null
        : createElement(
            "span",
            { className: "dsu-srOnly", id: errorId, role: "alert" },
            props.invalidText,
          ),
    ),
    createElement(
      "button",
      {
        type: "button",
        role: "switch",
        id: controlId,
        className: SWITCH_CLASS,
        "aria-checked": props.checked,
        "aria-describedby": describedBy.length === 0 ? undefined : describedBy,
        ...(props.invalidText === undefined
          ? {}
          : { "aria-invalid": true, "aria-errormessage": errorId }),
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
    /** 移动端数字键盘；小数步长默认 decimal，其余 numeric。 */
    inputMode?: "numeric" | "decimal";
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
  const controlId = nextDomId("dsu-field");
  const hintId =
    props.hint === undefined && props.detail === undefined ? undefined : `${controlId}-hint`;
  const errorId = `${controlId}-err`;
  const showError = invalid && showInvalid;
  const describedBy = [hintId, showError ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  const inputMode =
    props.inputMode ?? (props.step !== undefined && props.step < 1 ? "decimal" : "numeric");

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
    { ...props, controlId, ...(showError ? { invalidText: props.invalidHint } : {}) },
    createElement(
      "div",
      { className: "dsu-numberWrap" },
      createElement(
        "div",
        { className: "dsu-number" },
        createElement("input", {
          className: props.unit === undefined ? "dsu-input" : "dsu-input dsu-inputWithUnit",
          type: "text",
          inputMode,
          autoComplete: "off",
          spellCheck: false,
          id: controlId,
          value: draft,
          placeholder: props.placeholder,
          "aria-invalid": showError || undefined,
          "aria-errormessage": showError ? errorId : undefined,
          "aria-describedby": describedBy.length === 0 ? undefined : describedBy,
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
  const controlId = nextDomId("dsu-field");
  const hintId =
    props.hint === undefined && props.detail === undefined ? undefined : `${controlId}-hint`;
  const errorId = props.invalidText === undefined ? undefined : `${controlId}-err`;
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ");

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
    "aria-describedby": describedBy.length === 0 ? undefined : describedBy,
    "aria-invalid": props.invalidText === undefined ? undefined : true,
    "aria-errormessage": errorId,
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

/** 凭据行：password 输入 + 框内右缘 28×28 眼睛按钮；只有图标，不写「显示/隐藏」文字。 */
export function SecretField(
  props: FieldBase & {
    value: string;
    placeholder?: string;
    onChange: (next: string) => void;
    /** 父层撤销修改时自增：可见状态回到遮蔽，避免旧明文继续留在屏幕上。 */
    revealToken?: number;
  },
): ReactElement {
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealSeen = useRef(props.revealToken);
  const controlId =
    props.field === undefined ? `dsu-secret-${props.label}` : `dsu-secret-${props.field}`;
  const hintId =
    props.hint === undefined && props.detail === undefined ? undefined : `${controlId}-hint`;
  const errorId = props.invalidText === undefined ? undefined : `${controlId}-err`;
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ");

  useEffect(() => {
    if (!focused) {
      setDraft(props.value);
    }
  }, [props.value, focused]);

  useEffect(() => {
    if (revealSeen.current === props.revealToken) {
      return;
    }
    revealSeen.current = props.revealToken;
    setRevealed(false);
  }, [props.revealToken]);

  const revealLabel = `${props.label}，${revealed ? "隐藏" : "显示"}`;
  const eye = revealed
    ? createElement(
        "svg",
        { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true },
        createElement("path", {
          d: "M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
        }),
        createElement("path", {
          d: "M3.2 3.2l9.6 9.6",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
        }),
      )
    : createElement(
        "svg",
        { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true },
        createElement("path", {
          d: "M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
        }),
        createElement("circle", {
          cx: 8,
          cy: 8,
          r: 1.8,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.2,
        }),
      );

  return createElement(
    Field,
    { ...props, controlId },
    createElement(
      "div",
      { className: "dsu-secret" },
      createElement("input", {
        id: controlId,
        className: "dsu-input dsu-secretInput",
        type: revealed ? "text" : "password",
        value: draft,
        placeholder: props.placeholder,
        autoComplete: "off",
        spellCheck: false,
        "aria-describedby": describedBy.length === 0 ? undefined : describedBy,
        "aria-invalid": props.invalidText === undefined ? undefined : true,
        "aria-errormessage": errorId,
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
      }),
      createElement(
        "button",
        {
          type: "button",
          className: "dsu-secretEye",
          "aria-label": revealLabel,
          "aria-pressed": revealed,
          disabled: props.disabled === true,
          onClick: () => {
            setRevealed((previous) => !previous);
          },
        },
        eye,
      ),
    ),
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
  const controlId = nextDomId("dsu-field");
  const hintId =
    props.hint === undefined && props.detail === undefined ? undefined : `${controlId}-hint`;
  const errorId = props.invalidText === undefined ? undefined : `${controlId}-err`;
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ");

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
    "aria-describedby": describedBy.length === 0 ? undefined : describedBy,
    "aria-invalid": props.invalidText === undefined ? undefined : true,
    "aria-errormessage": errorId,
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
