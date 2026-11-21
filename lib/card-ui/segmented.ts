import { createElement } from "react";
import type { ReactElement } from "react";

/** 页签选项。 */
export interface SegmentedOption {
  value: string;
  label: string;
}

/** 分段页签：视图切换（如统计形态、时间粒度）。选中态由 `value` 控制。 */
export function Segmented(props: {
  options: readonly SegmentedOption[];
  value: string;
  onChange: (next: string) => void;
  /** 无障碍名（tablist 的 aria-label）。 */
  ariaLabel?: string;
}): ReactElement {
  return createElement(
    "div",
    {
      className: "dsu-seg",
      role: "tablist",
      "aria-label": props.ariaLabel,
    },
    ...props.options.map((option) =>
      createElement(
        "button",
        {
          key: option.value,
          type: "button",
          role: "tab",
          className: "dsu-segBtn",
          "aria-selected": option.value === props.value,
          "data-value": option.value,
          onClick: () => {
            props.onChange(option.value);
          },
        },
        option.label,
      ),
    ),
  );
}
