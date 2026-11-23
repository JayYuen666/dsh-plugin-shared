import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";

/** 表格列描述。`numeric` 右对齐 + tabular-nums，`mono` 等宽，`strong` 加粗主列，
 * `ellipsis` 单行省略（悬停弹出全文浮层；只作用于字符串格）。 */
export interface DataTableColumn {
  key: string;
  label: string;
  numeric?: boolean;
  mono?: boolean;
  strong?: boolean;
  ellipsis?: boolean;
}

/** 一行数据：`cells` 按列序对应 `columns`；不足的列补空。 */
export interface DataTableRow {
  key: string;
  cells: readonly ReactNode[];
}

/** 表头单元格类名。 */
function headClass(column: DataTableColumn): string {
  return column.numeric === true ? "dsu-tblNum" : "";
}

/** 全文浮层的最大宽度与估算高度（视口收口用；真实高度随内容行数变）。 */
const TIP_MAX_WIDTH = 360;
const TIP_EST_HEIGHT = 72;

/** 省略格：字符串值包一层单行省略。原生 `title` 在宿主的 webview 里不渲染，全文
 *  悬停改由自绘浮层承担——mouseenter 定位、mouseleave 收起；浮层 pointer-events:none，
 *  不反噬 hover 态。`aria-label` 保留给读屏（原生 title 的无障碍位由它接住）。
 *
 *  浮层**必须 portal 到 body**：表格的冻结列是 `position:sticky`（定位元素），会成为
 *  fixed 后代的包含块——浮层留在格内会被按格子原点重新解释坐标、再被表格的滚动壳裁掉，
 *  实测只剩一条窄缝。挂到 body 之后 fixed 坐标才是真正的视口坐标。 */
function EllipsisCell(props: { text: string }): ReactElement {
  const [tip, setTip] = useState<{ left: number; top: number; flip: boolean } | null>(null);
  return createElement(
    "span",
    {
      className: "dsu-tblEllip",
      "aria-label": props.text,
      onMouseEnter: (event: { readonly currentTarget: HTMLElement }): void => {
        const { currentTarget } = event;
        const rect = currentTarget.getBoundingClientRect();
        let { left } = rect;
        if (left + TIP_MAX_WIDTH > window.innerWidth - 8) {
          left = window.innerWidth - TIP_MAX_WIDTH - 8;
        }
        if (left < 8) {
          left = 8;
        }
        const flip = rect.bottom + TIP_EST_HEIGHT > window.innerHeight - 8;
        const top = flip ? Math.max(8, rect.top - 6) : rect.bottom + 6;
        setTip({ left, top, flip });
      },
      onMouseLeave: (): void => {
        setTip(null);
      },
    },
    props.text,
    tip === null
      ? null
      : createPortal(
          createElement(
            "span",
            {
              className: "dsu-tblTip",
              style: {
                left: `${tip.left}px`,
                top: `${tip.top}px`,
                ...(tip.flip ? { transform: "translateY(-100%)" } : {}),
              },
            },
            props.text,
          ),
          document.body,
        ),
  );
}

/** 数据单元格类名。 */
function cellClass(column: DataTableColumn): string {
  const classes = [
    column.numeric === true ? "dsu-tblNum" : "",
    column.mono === true ? "dsu-tblMono" : "",
    column.strong === true ? "dsu-tblId" : "",
  ].filter((entry) => entry !== "");
  return classes.join(" ");
}

/** 统一数据表：sticky 表头、行悬停、空数据不画空壳。 */
export function DataTable(props: {
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** 表格下方的窗口/口径说明行。 */
  foot?: ReactNode;
  /** 长表加纵向滚动（表头 sticky 依赖这个滚动容器）。 */
  scroll?: boolean | undefined;
  /** 首列冻结：横向滚动时身份列钉在左边（长表行数多、身份列窄的明细表用）。 */
  stickyFirst?: boolean | undefined;
  /** 读屏用的表名（设计稿要求每张全量表带 caption）；视觉上由 `.dsu-srOnly` 隐藏。 */
  caption?: string | undefined;
  /** `rows` 为空时替代整张表的内容；缺省什么都不渲染。 */
  empty?: ReactNode;
}): ReactElement | null {
  if (props.rows.length === 0) {
    if (props.empty === undefined) {
      return null;
    }
    return createElement("div", { className: "dsu-tblWrap" }, props.empty);
  }
  const caption =
    props.caption === undefined
      ? null
      : createElement("caption", { className: "dsu-srOnly" }, props.caption);
  const head = createElement(
    "thead",
    null,
    createElement(
      "tr",
      null,
      ...props.columns.map((column) =>
        createElement(
          "th",
          { key: column.key, scope: "col", className: headClass(column) },
          column.label,
        ),
      ),
    ),
  );
  const body = createElement(
    "tbody",
    null,
    ...props.rows.map((row) =>
      createElement(
        "tr",
        { key: row.key },
        ...props.columns.map((column, index) => {
          const raw = row.cells[index] ?? null;
          const cell =
            column.ellipsis === true && typeof raw === "string"
              ? createElement(EllipsisCell, { key: "cell", text: raw })
              : raw;
          return createElement("td", { key: column.key, className: cellClass(column) }, cell);
        }),
      ),
    ),
  );
  const tableClass = `dsu-tbl${props.stickyFirst === true ? " dsu-tblSticky" : ""}`;
  const children: ReactNode[] = [
    createElement("table", { className: tableClass }, caption, head, body),
  ];
  if (props.foot !== undefined) {
    children.push(createElement("div", { className: "dsu-tblFoot" }, props.foot));
  }
  return createElement(
    "div",
    { className: `dsu-tblWrap${props.scroll === true ? " dsu-tblScroll" : ""}` },
    ...children,
  );
}

/** 量条色调。 */
export type MeterTone = "business" | "ok" | "warn";

const METER_FILL_CLASS: Record<MeterTone, string> = {
  business: "dsu-meterFill",
  ok: "dsu-meterFill dsu-meterFillOk",
  warn: "dsu-meterFill dsu-meterFillWarn",
};

/** 列内相对量条：`ratio` 任意数（非法/越界一律钳回 0–1），右侧数值可自定义。 */
export function Meter(props: {
  ratio: number;
  label?: string | undefined;
  tone?: MeterTone | undefined;
}): ReactElement {
  const finite = Number.isFinite(props.ratio) ? props.ratio : 0;
  const clamped = Math.min(1, Math.max(0, finite));
  const percent = Math.round(clamped * 100);
  return createElement(
    "span",
    { className: "dsu-meter" },
    createElement(
      "span",
      { className: "dsu-meterTrack", "aria-hidden": true },
      createElement("span", {
        className: METER_FILL_CLASS[props.tone ?? "business"],
        style: { width: `${percent}%` },
      }),
    ),
    createElement("span", { className: "dsu-meterNum" }, props.label ?? `${percent}%`),
  );
}
