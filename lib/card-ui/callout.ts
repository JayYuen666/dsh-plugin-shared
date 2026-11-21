import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 警示条色调。 */
export type CalloutTone = "info" | "ok" | "warn" | "err";

const CALLOUT_CLASS: Record<CalloutTone, string> = {
  info: "dsu-callout dsu-calloutInfo",
  ok: "dsu-callout dsu-calloutOk",
  warn: "dsu-callout dsu-calloutWarn",
  err: "dsu-callout dsu-calloutErr",
};

const ICON_CLASS: Record<CalloutTone, string> = {
  info: "dsu-calloutIcon",
  ok: "dsu-calloutIcon dsu-calloutIconOk",
  warn: "dsu-calloutIcon dsu-calloutIconWarn",
  err: "dsu-calloutIcon dsu-calloutIconErr",
};

/** 各色调的图形符号。SVG 是图形不是文案，`aria-hidden` 后由正文承载语义。 */
const ICON_SVG: Record<CalloutTone, ReactElement> = {
  info: createElement(
    "svg",
    { width: 10, height: 10, viewBox: "0 0 12 12", "aria-hidden": true },
    createElement("path", {
      d: "M6 5.4v3.8",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
    createElement("circle", { cx: 6, cy: 3.2, r: 0.9, fill: "currentColor" }),
  ),
  ok: createElement(
    "svg",
    { width: 10, height: 10, viewBox: "0 0 12 12", "aria-hidden": true },
    createElement("path", {
      d: "M2.5 6.5 5 9l4.5-5.5",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  ),
  warn: createElement(
    "svg",
    { width: 10, height: 10, viewBox: "0 0 12 12", "aria-hidden": true },
    createElement("path", {
      d: "M6 2.5v4.4",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
    createElement("circle", { cx: 6, cy: 9.3, r: 0.9, fill: "currentColor" }),
  ),
  err: createElement(
    "svg",
    { width: 10, height: 10, viewBox: "0 0 12 12", "aria-hidden": true },
    createElement("path", {
      d: "M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
  ),
};

/** 警示条：提示、降级说明、越界原因这一类需要与正文区分的完整句子。 */
export function Callout(props: {
  tone?: CalloutTone | undefined;
  /** 设置键名锚点（`data-field`，供测试定位），不是 DOM id。 */
  field?: string | undefined;
  children?: ReactNode;
}): ReactElement {
  const tone = props.tone ?? "info";
  return createElement(
    "div",
    { className: CALLOUT_CLASS[tone], "data-field": props.field },
    createElement("span", { className: ICON_CLASS[tone], "aria-hidden": true }, ICON_SVG[tone]),
    props.children,
  );
}
