/// <reference lib="dom" />
import { nextDomId } from "./ids.ts";
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, ReactElement, ReactNode } from "react";

/** 浮层方位：字段说明从帮助图标右侧展开；小节标题的说明从上方展开（设计稿 `.sec-tip`）。 */
export type TipPlacement = "side" | "above";

/** 所有字段共享的文案与状态位。 */
export interface FieldBase {
  label: string;
  hint?: string;
  detail?: string;
  /** 设置键名，写到控件的 `data-field`（检查与测试的稳定锚点），不是 DOM id。 */
  field?: string;
  disabled?: boolean;
  wide?: boolean;
  compact?: boolean;
  /** 校验错误：只进标签行的错误徽标与帮助浮层，不在字段下方另起一行。 */
  invalidText?: string;
  /** 标签与控件的排布；成组布尔项用 `row`（设计稿 `.toggle-cell`）。 */
  layout?: "stack" | "row";
  /** 控件的 DOM id；字段组件用 `nextDomId` 生成，FieldLabel 用它建立 label↔control 关联。 */
  controlId?: string;
}

/** 说明按钮与浮层：悬停/聚焦显示，点击钉住，Esc 或点击外部关闭。 */
export function InfoTip(props: {
  label: string;
  detail: string;
  /** 是否渲染可见字段名；FieldLabel 自己渲染标签时传 false，避免重复。 */
  showLabel?: boolean;
  compact?: boolean;
  /** 错误态：帮助按钮与浮层换成 error 语义色。 */
  error?: boolean;
  /** 错误正文；与说明同处一个浮层，错误排在说明之前。 */
  errorText?: string;
  /** 字段默认在右侧；小节标题使用 above，箭头向下。 */
  placement?: TipPlacement;
}): ReactElement {
  const id = nextDomId("dsu-tip");
  const placement = props.placement ?? "side";
  const [open, setOpen] = useState(false);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const pinnedRef = useRef(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback((): void => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const place = useCallback((): void => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    /* v8 ignore next 3 -- place 只在 open 的 layout effect 与挂载期监听器里调用；refs 为空只可能是卸载竞态 */
    if (anchor === null || tip === null) {
      return;
    }
    tip.style.marginTop = "0px";
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const rect = anchor.getBoundingClientRect();
    const edge = 8;
    let left: number;
    let top: number;
    let side: "right" | "left" | "above" | "below";
    if (placement === "above") {
      // 小节标题：浮层在按钮上方居中，箭头向下（设计稿 `.tip.sec-tip`）。
      left = rect.left + rect.width / 2 - width / 2;
      top = rect.top - height - edge;
      side = "above";
      if (top < edge) {
        top = rect.bottom + edge;
        side = "below";
      }
    } else {
      // 字段说明：浮层贴在帮助图标右侧，顶部对齐；右侧放不下时翻到左侧，再退到上方。
      left = rect.right + edge;
      top = Math.max(edge, rect.top);
      side = "right";
      if (left + width > window.innerWidth - edge) {
        const onLeft = rect.left - width - edge;
        if (onLeft >= edge) {
          left = onLeft;
          side = "left";
        } else {
          left = rect.left + rect.width / 2 - width / 2;
          top = rect.top - height - edge;
          side = "above";
          if (top < edge) {
            top = rect.bottom + edge;
            side = "below";
          }
        }
      }
      if (top + height > window.innerHeight - edge) {
        top = Math.max(edge, window.innerHeight - height - edge);
      }
    }
    const maxLeft = Math.max(edge, window.innerWidth - width - edge);
    const maxTop = Math.max(edge, window.innerHeight - height - edge);
    tip.dataset["side"] = side;
    tip.style.left = `${Math.min(Math.max(edge, left), maxLeft)}px`;
    tip.style.top = `${Math.min(Math.max(edge, top), maxTop)}px`;
  }, [placement]);

  const close = useCallback((): void => {
    cancelHide();
    pinnedRef.current = false;
    setOpen(false);
  }, [cancelHide]);

  const show = useCallback((): void => {
    cancelHide();
    setOpen(true);
  }, [cancelHide]);

  const scheduleHide = useCallback((): void => {
    cancelHide();
    if (hoveredRef.current || focusedRef.current || pinnedRef.current) {
      return;
    }
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      /* v8 ignore next 3 -- 任何重新进入/钉住都会 cancelHide；这次复查只防未来的异步路径 */
      if (!hoveredRef.current && !focusedRef.current && !pinnedRef.current) {
        setOpen(false);
      }
    }, 120);
  }, [cancelHide]);

  const updatePinned = useCallback((next: boolean): void => {
    pinnedRef.current = next;
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return () => {
        /* 关闭状态没有需要清理的定位或监听器。 */
      };
    }
    place();
    const onScroll = (event: Event): void => {
      const { target } = event;
      if (target instanceof Node && tipRef.current?.contains(target) === true) {
        return;
      }
      if (pinnedRef.current) {
        place();
        return;
      }
      close();
    };
    const onResize = (): void => {
      place();
    };
    const onPointerDown = (event: PointerEvent): void => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PointerEvent.target 在当前环境恒为 Node；跨 realm（iframe）场景不存在，contains 只接受 Node|null。
      const target = event.target as Node | null;
      if (wrapRef.current?.contains(target) === true) {
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, props.detail, place, close]);

  useEffect(() => {
    if (!open) {
      return () => {
        /* 关闭状态没有需要清理的键盘监听器。 */
      };
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => cancelHide, [cancelHide]);

  const button = createElement(
    "button",
    {
      ref: anchorRef,
      type: "button",
      className: `dsu-helpBtn${props.error === true ? " dsu-helpBtnError" : ""}`,
      "aria-label": props.error === true ? `${props.label}，错误详情与说明` : `${props.label} 说明`,
      "aria-expanded": open,
      "aria-controls": id,
      onClick: () => {
        if (pinnedRef.current) {
          close();
          return;
        }
        updatePinned(true);
        show();
      },
    },
    createElement(
      "svg",
      { width: 12, height: 12, viewBox: "0 0 14 14", "aria-hidden": true },
      createElement("circle", {
        cx: 7,
        cy: 7,
        r: 6,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.2,
      }),
      createElement("path", {
        d: "M7 6.2v4",
        stroke: "currentColor",
        strokeWidth: 1.3,
        strokeLinecap: "round",
      }),
      createElement("circle", { cx: 7, cy: 4.3, r: 0.8, fill: "currentColor" }),
    ),
  );

  const tipBody: ReactNode[] = [];
  if (props.errorText !== undefined) {
    tipBody.push(
      createElement("span", { key: "error", className: "dsu-tipErrorText" }, props.errorText),
    );
  }
  if (props.detail.length > 0) {
    tipBody.push(createElement("span", { key: "detail" }, props.detail));
  }

  const tip = createElement(
    "div",
    {
      ref: tipRef,
      id,
      role: "tooltip",
      className: `dsu-tip${props.error === true ? " dsu-tipError" : ""}`,
      "data-side": placement === "above" ? "above" : "right",
      hidden: !open,
    },
    createElement("div", { className: "dsu-tipBody" }, ...tipBody),
  );

  const labelNode =
    props.showLabel === false
      ? null
      : createElement(
          "span",
          { className: `dsu-label${props.compact === true ? " dsu-labelMono" : ""}` },
          props.label,
        );

  return createElement(
    "span",
    {
      ref: wrapRef,
      className: "dsu-help",
      onMouseEnter: (): void => {
        hoveredRef.current = true;
        show();
      },
      onMouseLeave: (): void => {
        hoveredRef.current = false;
        scheduleHide();
      },
      onFocus: (): void => {
        focusedRef.current = true;
        show();
      },
      onBlur: (event: ReactFocusEvent<HTMLSpanElement>): void => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) {
          return;
        }
        focusedRef.current = false;
        scheduleHide();
      },
    },
    labelNode,
    button,
    tip,
  );
}

/** 字段名 + 可选说明按钮。 */
export function FieldLabel(props: {
  label: string;
  detail?: string | undefined;
  compact?: boolean | undefined;
  controlId?: string | undefined;
  invalidText?: string | undefined;
}): ReactElement {
  const labelClass = `dsu-label${props.compact === true ? " dsu-labelMono" : ""}`;
  const labelNode =
    props.controlId === undefined
      ? createElement("span", { className: labelClass }, props.label)
      : createElement("label", { className: labelClass, htmlFor: props.controlId }, props.label);
  const hasTip = props.detail !== undefined || props.invalidText !== undefined;
  return createElement(
    "div",
    { className: "dsu-labelRow" },
    labelNode,
    hasTip
      ? createElement(InfoTip, {
          label: props.label,
          detail: props.detail ?? "",
          showLabel: false,
          error: props.invalidText !== undefined,
          ...(props.invalidText === undefined ? {} : { errorText: props.invalidText }),
        })
      : null,
    props.invalidText === undefined
      ? null
      : createElement("span", { className: "dsu-errBadge" }, props.invalidText),
  );
}

/** 字段的基础布局：标签行在上、控件在下；说明只进帮助浮层，错误另在标签行显示截断徽标。
 *  两者还各有一份 `.dsu-srOnly` 文本供读屏，视觉上都不占第三行。 */
export function Field(props: FieldBase & { children?: ReactNode }): ReactElement {
  const hintId = props.controlId === undefined ? undefined : `${props.controlId}-hint`;
  const errorId = props.controlId === undefined ? undefined : `${props.controlId}-err`;
  const tipDetail =
    props.hint === undefined || props.detail === undefined
      ? (props.detail ?? props.hint)
      : `${props.detail} ${props.hint}`;
  return createElement(
    "div",
    {
      className: `dsu-field${props.wide === true ? " dsu-fieldWide" : ""}${props.layout === "row" ? " dsu-fieldRow" : ""}`,
    },
    createElement(
      "div",
      { className: "dsu-fieldMeta" },
      createElement(FieldLabel, {
        label: props.label,
        detail: tipDetail,
        compact: props.compact,
        controlId: props.controlId,
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
    createElement("div", { className: "dsu-control" }, props.children),
  );
}
