import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "./badge.ts";

/** 设置卡根容器：无外框、纵向排列。 */
export function CardForm(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-form" }, props.children);
}

/** 小节：分隔线 + 标题（可带计数徽章与右侧动作位）+ 可选说明。 */
export function Section(props: {
  title: string;
  hint?: string;
  /** 标题旁的计数徽章文案（如 "4 Provider"）。 */
  count?: string | undefined;
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
      props.count === undefined ? null : createElement(Badge, { tone: "business" }, props.count),
      props.actions === undefined
        ? null
        : createElement("div", { className: "dsu-sectionActions" }, props.actions),
    ),
    props.hint === undefined
      ? null
      : createElement("p", { className: "dsu-sectionHint" }, props.hint),
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
