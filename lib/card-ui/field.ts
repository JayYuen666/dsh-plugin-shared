/// <reference lib="dom" />
import {
  createElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FocusEvent as ReactFocusEvent, ReactElement, ReactNode } from "react";

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
  /** 控件的 DOM id；字段组件用 `useId` 生成，FieldLabel 用它建立 label↔control 关联。 */
  controlId?: string;
}

/** 说明按钮与浮层：悬停/聚焦显示，点击钉住，Esc 关闭。 */
export function InfoTip(props: {
  label: string;
  detail: string;
  /** 是否渲染可见字段名；FieldLabel 自己渲染标签时传 false，避免重复。 */
  showLabel?: boolean;
  compact?: boolean;
}): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const pinnedRef = useRef(false);
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
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let { left } = rect;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) {
      top = rect.top - height - 8;
    }
    if (left + width > window.innerWidth - 8) {
      left = window.innerWidth - width - 8;
    }
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    tip.style.left = `${Math.min(Math.max(8, left), maxLeft)}px`;
    tip.style.top = `${Math.min(Math.max(8, top), maxTop)}px`;
  }, []);

  const close = useCallback((): void => {
    cancelHide();
    pinnedRef.current = false;
    setPinned(false);
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
    setPinned(next);
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
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
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
      className: "dsu-helpBtn",
      "aria-label": `${props.label} 说明`,
      "aria-describedby": id,
      "aria-pressed": pinned,
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

  const tip = createElement(
    "div",
    {
      ref: tipRef,
      id,
      role: "tooltip",
      className: "dsu-tip",
      hidden: !open,
    },
    props.detail,
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
}): ReactElement {
  const labelClass = `dsu-label${props.compact === true ? " dsu-labelMono" : ""}`;
  const labelNode =
    props.controlId === undefined
      ? createElement("span", { className: labelClass }, props.label)
      : createElement("label", { className: labelClass, htmlFor: props.controlId }, props.label);
  return createElement(
    "div",
    { className: "dsu-labelRow" },
    labelNode,
    props.detail === undefined
      ? null
      : createElement(InfoTip, {
          label: props.label,
          detail: props.detail,
          showLabel: false,
        }),
  );
}

/** 行式字段的基础布局：左标签/提示，右控件。 */
export function Field(props: FieldBase & { children?: ReactNode }): ReactElement {
  const hintId = props.controlId === undefined ? undefined : `${props.controlId}-hint`;
  return createElement(
    "div",
    { className: `dsu-field${props.wide === true ? " dsu-fieldWide" : ""}` },
    createElement(
      "div",
      { className: "dsu-fieldMeta" },
      createElement(FieldLabel, {
        label: props.label,
        detail: props.detail,
        compact: props.compact,
        controlId: props.controlId,
      }),
      props.hint === undefined
        ? null
        : createElement("p", { className: "dsu-hint", id: hintId }, props.hint),
    ),
    createElement("div", { className: "dsu-control" }, props.children),
  );
}
