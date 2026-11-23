import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 徽章色调。 */
export type BadgeTone = "neutral" | "business" | "ok" | "warn" | "err";

/** 状态点色调。 */
export type DotTone = "ok" | "warn" | "err" | "mute";

const DOT_CLASS: Record<DotTone, string> = {
  ok: "dsu-dot dsu-dotOk",
  warn: "dsu-dot dsu-dotWarn",
  err: "dsu-dot dsu-dotErr",
  mute: "dsu-dot dsu-dotMute",
};

/** 语义状态点：只表达状态，不带文字。
 *
 *  `label` 可选：表格状态列这类「只有一颗点」的位置必须让读屏也能读出「规范/非规范」；
 *  给了 label 就去掉 aria-hidden，补 role=img / aria-label / title，视觉仍只是一颗点。 */
export function StatusDot(props: {
  tone?: DotTone | undefined;
  label?: string | undefined;
}): ReactElement {
  return createElement("span", {
    className: DOT_CLASS[props.tone ?? "mute"],
    ...(props.label === undefined
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": props.label, title: props.label }),
  });
}

const BADGE_CLASS: Record<BadgeTone, string> = {
  neutral: "dsu-badge dsu-badgeNeutral",
  business: "dsu-badge dsu-badgeBusiness",
  ok: "dsu-badge dsu-badgeOk",
  warn: "dsu-badge dsu-badgeWarn",
  err: "dsu-badge dsu-badgeErr",
};

/** 圆角徽章：CLI 档位、实验标记、脏态计数这一类短状态。
 *
 *  `dot` 可选：设计稿的 CLI 档位徽章在文字前带一颗 8px 状态点（如「版本偏离」warn、
 *  「未检测到」err）。点的色调独立于徽章底色，调用方按状态给值；不传就不画点。
 *  `field` 沿用卡片里 `data-field` 的定位约定，供宿主的卡片检查器读取。 */
export function Badge(props: {
  tone?: BadgeTone | undefined;
  dot?: DotTone | undefined;
  field?: string | undefined;
  children?: ReactNode;
}): ReactElement {
  const dot =
    props.dot === undefined ? null : createElement(StatusDot, { key: "dot", tone: props.dot });
  return createElement(
    "span",
    {
      className: BADGE_CLASS[props.tone ?? "neutral"],
      ...(props.field === undefined ? {} : { "data-field": props.field }),
    },
    dot,
    props.children,
  );
}
