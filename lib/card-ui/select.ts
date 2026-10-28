/// <reference lib="dom" />
import {
  createElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from "react";
import { Field } from "./field.ts";
import type { FieldBase } from "./field.ts";

/** 一个候选项。`value` 必须在整份 options 里唯一：它同时是 React key 与选中判断依据。 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

/** 自定义下拉：浮层固定定位，键盘可选，点击外部关闭。 */
export function SelectField(
  props: FieldBase & {
    value: string;
    options: readonly SelectOption[];
    onChange: (next: string) => void;
  },
): ReactElement {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const controlId = useId();
  const describedBy = props.hint === undefined ? undefined : `${controlId}-hint`;
  const { disabled, value, options, onChange } = props;
  const enabled = useMemo(
    () =>
      options
        .map((option, index) => ({ option, index }))
        .filter((entry) => entry.option.disabled !== true),
    [options],
  );
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;
  const activeOption = options[active];
  const activeValid = activeOption !== undefined && activeOption.disabled !== true;

  const place = useCallback((): void => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    /* v8 ignore next 3 -- place 只在 open 的 layout effect 里调用；refs 为空只可能是卸载竞态 */
    if (trigger === null || menu === null) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - 16);
    let { left } = rect;
    if (left + width > window.innerWidth - 8) {
      left = window.innerWidth - width - 8;
    }
    const height = menu.offsetHeight;
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = rect.top - height - 6;
    }
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.min(Math.max(8, left), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(8, top), maxTop)}px`;
  }, []);

  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  const openMenu = useCallback((): void => {
    if (disabled === true) {
      return;
    }
    const initial = enabled.find((entry) => entry.option.value === value) ?? enabled.at(0);
    if (initial === undefined) {
      return;
    }
    setActive(initial.index);
    setOpen(true);
  }, [disabled, value, enabled]);

  const select = useCallback(
    (index: number): void => {
      /* v8 ignore next 3 -- 浮层只能经由 openMenu 打开；组件禁用时打不开 */
      if (disabled === true) {
        return;
      }
      const option = options[index];
      /* v8 ignore next 3 -- disabled 选项在浏览器里不派发 click；越界下标由调用面保证 */
      if (option === undefined || option.disabled === true) {
        return;
      }
      onChange(option.value);
      close();
      triggerRef.current?.focus();
    },
    [disabled, options, onChange, close],
  );

  const move = useCallback(
    (delta: number): void => {
      const position = enabled.findIndex((entry) => entry.index === active);
      /* v8 ignore next 5 -- open 时归一 effect 已保证 enabled 非空且 active 落在可用项上 */
      if (position === -1 || enabled.length === 0) {
        return;
      }
      const next = (position + delta + enabled.length) % enabled.length;
      const entry = enabled[next];
      /* v8 ignore next 3 -- next 由取模保证在界内 */
      if (entry === undefined) {
        return;
      }
      setActive(entry.index);
    },
    [active, enabled],
  );

  useLayoutEffect(() => {
    if (!open) {
      return () => {
        /* 关闭状态没有需要清理的定位或监听器。 */
      };
    }
    place();
    const onPointerDown = (event: PointerEvent): void => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PointerEvent.target 在当前环境恒为 Node；跨 realm（iframe）场景不存在，contains 只接受 Node|null。
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) === true) {
        return;
      }
      if (triggerRef.current?.contains(target) === true) {
        return;
      }
      close();
    };
    const onScroll = (event: Event): void => {
      const { target } = event;
      if (target instanceof Node && menuRef.current?.contains(target) === true) {
        return;
      }
      close();
    };
    const onResize = (): void => {
      place();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, props.options, place, close]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (disabled === true || enabled.length === 0) {
      close();
      return;
    }
    if (enabled.some((entry) => entry.index === active)) {
      return;
    }
    const selectedEntry = enabled.find((entry) => entry.option.value === value);
    const fallback = selectedEntry ?? enabled.at(0);
    /* v8 ignore next 3 -- enabled 非空在上一分支已保证 */
    if (fallback === undefined) {
      return;
    }
    setActive(fallback.index);
  }, [open, disabled, value, options, active, close, enabled]);

  // 把活动选项滚进菜单可视区：只调整菜单自身 scrollTop，避免 scrollIntoView 连带滚动外部容器。
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const menu = menuRef.current;
    /* v8 ignore next 2 -- 同上，menu 在 open 的 commit 之后必然已挂上 */
    if (menu === null) {
      return;
    }
    const node = menu.querySelector<HTMLElement>('[data-active="true"]');
    /* v8 ignore next 2 -- active 已由归一 effect 保证落在可用项上 */
    if (node === null) {
      return;
    }
    if (node.offsetTop < menu.scrollTop) {
      menu.scrollTop = node.offsetTop;
      return;
    }
    if (node.offsetTop + node.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = node.offsetTop + node.offsetHeight - menu.clientHeight;
    }
  }, [open, active, options]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) {
        openMenu();
      }
      if (enabled.length === 0) {
        return;
      }
      const entry = event.key === "Home" ? enabled.at(0) : enabled.at(-1);
      /* v8 ignore next 3 -- enabled 为空已在上一条返回 */
      if (entry === undefined) {
        return;
      }
      setActive(entry.index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      select(active);
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "Escape") {
      close();
    }
  };

  const optionNodes: ReactNode[] = [];
  let lastGroup: string | undefined;
  for (const [index, option] of options.entries()) {
    if (option.group !== lastGroup) {
      if (option.group !== undefined) {
        optionNodes.push(
          createElement(
            "div",
            {
              key: `group-${index}-${option.group}`,
              className: "dsu-optionGroup",
              role: "presentation",
            },
            option.group,
          ),
        );
      }
      lastGroup = option.group;
    }
    optionNodes.push(
      createElement(
        "button",
        {
          key: `option-${option.value}`,
          type: "button",
          role: "option",
          id: `${baseId}-${index}`,
          className: "dsu-option",
          tabIndex: -1,
          "aria-selected": option.value === props.value,
          "data-active": index === active,
          disabled: option.disabled === true,
          onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>): void => {
            // 指针按下不转移焦点：键盘交互始终留在触发器上（aria-activedescendant 模型）。
            event.preventDefault();
          },
          onClick: () => {
            select(index);
          },
          onMouseEnter: () => {
            /* v8 ignore next -- happy-dom 对 disabled 元素不派发 mouse 事件；浏览器实现各有差异，保留禁用检查 */
            if (option.disabled !== true) {
              setActive(index);
            }
          },
        },
        createElement("span", null, option.label),
        createElement(
          "svg",
          {
            className: "dsu-check",
            width: 14,
            height: 14,
            viewBox: "0 0 14 14",
            "aria-hidden": true,
          },
          createElement("path", {
            d: "M2.5 7.5l3 3 6-7",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        ),
      ),
    );
  }

  return createElement(
    Field,
    { ...props, controlId },
    createElement(
      "div",
      {
        className: "dsu-selectWrap",
        onBlur: (event: ReactFocusEvent<HTMLDivElement>): void => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) {
            return;
          }
          close();
        },
      },
      createElement(
        "button",
        {
          ref: triggerRef,
          type: "button",
          id: controlId,
          className: "dsu-select dsu-input",
          role: "combobox",
          "aria-haspopup": "listbox",
          "aria-expanded": open,
          "aria-controls": `${baseId}-list`,
          "aria-activedescendant": open && activeValid ? `${baseId}-${active}` : undefined,
          "aria-describedby": describedBy,
          "data-field": props.field,
          disabled: disabled === true || options.length === 0,
          onClick: () => {
            if (open) {
              close();
              return;
            }
            openMenu();
          },
          onKeyDown,
        },
        createElement("span", { className: "dsu-selectValue" }, selectedLabel),
        createElement(
          "svg",
          {
            className: "dsu-chevron",
            width: 14,
            height: 14,
            viewBox: "0 0 14 14",
            "aria-hidden": true,
          },
          createElement("path", {
            d: "M3 5l4 4 4-4",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        ),
      ),
      createElement(
        "div",
        {
          ref: menuRef,
          id: `${baseId}-list`,
          role: "listbox",
          className: "dsu-menu",
          "aria-label": props.label,
          hidden: !open,
        },
        ...optionNodes,
      ),
    ),
  );
}
