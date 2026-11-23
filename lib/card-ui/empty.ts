import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 空态统一用的「空托盘」线性图标：20px、1.5 描边、currentColor（画板 D 的空状态规范）。
 *  九仓共用一个图形，不各画各的；空态不是错误，所以图形不取语义色。 */
function EmptyTrayIcon(): ReactElement {
  return createElement(
    "span",
    { className: "dsu-emptyIcon", "aria-hidden": true },
    createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 20,
        height: 20,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      createElement("polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12" }),
      createElement("path", {
        d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
      }),
    ),
  );
}

/** 空态：空窗口、空列表、无数据。空数据不画空壳，替换整块内容。
 *  图标 + 标题 + 一句指路（为什么空、下一步做什么），不渲染骨架占位。 */
export function EmptyState(props: {
  title?: string;
  children?: ReactNode;
  /** 外层已有卡片/表格边框时用无边框形态（画板 D：块级空态在卡内不再画第二层虚线）。 */
  plain?: boolean;
}): ReactElement {
  const children: ReactNode[] = [createElement(EmptyTrayIcon, { key: "icon" })];
  if (props.title !== undefined) {
    children.push(
      createElement("span", { key: "title", className: "dsu-emptyTitle" }, props.title),
    );
  }
  if (props.children !== undefined) {
    children.push(
      createElement("span", { key: "body", className: "dsu-emptyBody" }, props.children),
    );
  }
  return createElement(
    "div",
    { className: props.plain === true ? "dsu-empty dsu-emptyPlain" : "dsu-empty" },
    ...children,
  );
}
