import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 设置卡根容器：无外框、纵向排列。 */
export function CardForm(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-form" }, props.children);
}

/** 小节：分隔线 + 标题 + 可选说明。 */
export function Section(props: {
  title: string;
  hint?: string;
  children?: ReactNode;
}): ReactElement {
  return createElement(
    "section",
    { className: "dsu-section" },
    createElement("h2", { className: "dsu-sectionTitle" }, props.title),
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
