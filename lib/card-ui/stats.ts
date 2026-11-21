import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** KPI 瓦片栅格：auto-fit 排布，窄容器自动折行。 */
export function KpiGrid(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-kpiGrid" }, props.children);
}

/** 瓦片内的涨跌标注；涨跌方向只决定着色，文案由调用方给全。 */
export interface KpiDelta {
  direction: "up" | "down";
  text: string;
}

/** 单格 KPI：数值一律 tabular-nums；`value` 建议传已格式化的字符串（如 "46.2k"）。 */
export function KpiTile(props: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  sub?: string | undefined;
  delta?: KpiDelta | undefined;
  /**
   * 可数整数的原始值：给了就渲染 `data-count`，由样式表播一次数字滚动动画。
   * 只有「次数」这类可数整数才传——格式化串（`4.0k`/`62%`）反解析是近似值，
   * 拿去当动画目标是把近似当精确。
   */
  count?: number | undefined;
}): ReactElement {
  const children: ReactNode[] = [createElement("div", { className: "dsu-kpiLabel" }, props.label)];
  const valueChildren: ReactNode[] = [props.value];
  if (props.unit !== undefined) {
    valueChildren.push(createElement("span", { className: "dsu-kpiUnit" }, props.unit));
  }
  const counted = props.count !== undefined;
  const countStyle = counted ? ({ "--dsu-count-target": String(props.count) } as const) : undefined;
  children.push(
    createElement(
      "div",
      {
        className: "dsu-kpiValue",
        ...(counted ? { "data-count": props.count, style: countStyle } : {}),
      },
      ...valueChildren,
    ),
  );
  if (props.sub !== undefined) {
    children.push(createElement("div", { className: "dsu-kpiSub" }, props.sub));
  }
  if (props.delta !== undefined) {
    children.push(
      createElement(
        "span",
        {
          className: `dsu-kpiDelta ${
            props.delta.direction === "up" ? "dsu-kpiDeltaUp" : "dsu-kpiDeltaDown"
          }`,
        },
        props.delta.text,
      ),
    );
  }
  return createElement("div", { className: "dsu-kpi" }, ...children);
}
