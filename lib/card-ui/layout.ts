import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "./badge.ts";
import { InfoTip } from "./field.ts";

/** 设置卡根容器：无外框、纵向排列。 */
export function CardForm(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-form" }, props.children);
}

/** 小节：分隔线 + 标题（可带说明按钮、计数徽章、节级开关与右侧动作位）。 */
export function Section(props: {
  title: string;
  /** 小节说明：只进标题旁 ⓘ 的上方浮层，不占正文行。 */
  hint?: string;
  /** 标题旁的计数徽章文案（如 "4 Provider"）。 */
  count?: string | undefined;
  /** 节级开关（如“启用自动续跑”）放在标题行右侧。 */
  toggle?: ReactNode;
  /** 标题右侧的动作位（刷新、恢复默认这一类小按钮）。 */
  actions?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  return createElement(
    "section",
    { className: "dsu-section" },
    createElement(
      "div",
      { className: "dsu-sectionHead" },
      createElement("h2", { className: "dsu-sectionTitle" }, props.title),
      props.hint === undefined
        ? null
        : createElement(InfoTip, {
            label: props.title,
            detail: props.hint,
            showLabel: false,
            placement: "above",
          }),
      props.count === undefined ? null : createElement(Badge, { tone: "business" }, props.count),
      props.toggle === undefined && props.actions === undefined
        ? null
        : createElement("div", { className: "dsu-sectionActions" }, props.toggle, props.actions),
    ),
    props.children,
  );
}

/** 紧凑栅格：只用于工具开关这类重复布尔项。 */
export function FieldGrid(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-grid" }, props.children);
}

/** 双列字段栅格：并排两组 Field（标签在上、控件在下），窄屏折单列。
 *  只放 Field 系组件——栅格假定子项是 `.dsu-field`。 */
export function FieldTwoCol(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-fieldCols" }, props.children);
}

/** 一行状态 chips，以 `·` 分隔。 */
export function StatusBar(props: { items: readonly string[] }): ReactElement | null {
  if (props.items.length === 0) {
    return null;
  }
  const children = props.items.map((item, index) =>
    createElement("span", { key: index }, index === 0 ? item : `· ${item}`),
  );
  return createElement("div", { className: "dsu-statusbar" }, ...children);
}
