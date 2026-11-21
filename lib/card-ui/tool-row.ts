import { Fragment, createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { StatusDot } from "./badge.ts";
import type { DotTone } from "./badge.ts";

/** 工具调用摘要行：toolview 里一个工具的一次执行。 */
export function ToolRow(props: {
  /** 工具名（等宽呈现）。 */
  name: string;
  tone?: DotTone | undefined;
  /** 右侧相位标注（preparing / start / result）。 */
  phase?: string | undefined;
  /** 头部附加徽章（如 HTTP 状态码）。 */
  badge?: ReactNode;
  children?: ReactNode;
  /** 底部动作区（如「查看轨迹」）。 */
  foot?: ReactNode;
}): ReactElement {
  return createElement(
    "div",
    { className: "dsu-toolrow" },
    createElement(
      "div",
      { className: "dsu-toolrowHead" },
      createElement(StatusDot, { tone: props.tone }),
      createElement("span", { className: "dsu-toolrowName" }, props.name),
      props.badge,
      props.phase === undefined
        ? null
        : createElement("span", { className: "dsu-toolrowPhase" }, props.phase),
    ),
    props.children,
    props.foot === undefined
      ? null
      : createElement("div", { className: "dsu-toolrowFoot" }, props.foot),
  );
}

/** 键值对栅格容器：`ToolRowItem` 必须放进它里面。 */
export function ToolRowGrid(props: { children?: ReactNode }): ReactElement {
  return createElement("div", { className: "dsu-toolrowKv" }, props.children);
}

/** 值的语义色调；缺省与 ok 都用主文字色，warn/err 才着语义色。 */
export type ToolRowValueTone = "ok" | "warn" | "err";

const VALUE_TONE_CLASS: Record<ToolRowValueTone, string> = {
  ok: "dsu-toolrowVal",
  warn: "dsu-toolrowVal dsu-toolrowValWarn",
  err: "dsu-toolrowVal dsu-toolrowValErr",
};

/** 一对键值。等宽呈现，长值折行。 */
export function ToolRowItem(props: {
  label: string;
  value: ReactNode;
  tone?: ToolRowValueTone;
}): ReactElement {
  return createElement(
    Fragment,
    null,
    createElement("span", { className: "dsu-toolrowKey" }, props.label),
    createElement("span", { className: VALUE_TONE_CLASS[props.tone ?? "ok"] }, props.value),
  );
}
