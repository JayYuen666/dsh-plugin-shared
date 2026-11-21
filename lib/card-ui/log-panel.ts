import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { StatusDot } from "./badge.ts";
import type { DotTone } from "./badge.ts";

/** 日志面板头部的一个动作按钮。 */
export interface LogPanelAction {
  label: string;
  onClick: () => void;
}

/** 日志 / 输出面板：命令输出、作业日志、重建回执这一类等宽文本面。 */
export function LogPanel(props: {
  /** 头部说明（含时间、作业号等）；无头部内容时不渲染头部。 */
  label?: ReactNode;
  tone?: DotTone | undefined;
  actions?: readonly LogPanelAction[] | undefined;
  children?: ReactNode;
}): ReactElement {
  const actions = props.actions ?? [];
  const hasHead = props.label !== undefined || props.tone !== undefined || actions.length > 0;
  const head = hasHead
    ? createElement(
        "div",
        { className: "dsu-logHead" },
        createElement(StatusDot, { tone: props.tone }),
        props.label,
        actions.length > 0
          ? createElement(
              "span",
              { className: "dsu-logActions" },
              ...actions.map((action) =>
                createElement(
                  "button",
                  {
                    key: action.label,
                    type: "button",
                    className: "dsu-logAction",
                    onClick: action.onClick,
                  },
                  action.label,
                ),
              ),
            )
          : null,
      )
    : null;
  return createElement(
    "div",
    { className: "dsu-log" },
    head,
    createElement("pre", { className: "dsu-logBody" }, props.children),
  );
}
