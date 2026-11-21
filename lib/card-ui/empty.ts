import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 空态：空窗口、空列表、无数据。空数据不画空壳，替换整块内容。 */
export function EmptyState(props: { title?: string; children?: ReactNode }): ReactElement {
  const children: ReactNode[] = [];
  if (props.title !== undefined) {
    children.push(createElement("span", { className: "dsu-emptyTitle" }, props.title));
  }
  if (props.children !== undefined) {
    children.push(props.children);
  }
  return createElement("div", { className: "dsu-empty" }, ...children);
}
