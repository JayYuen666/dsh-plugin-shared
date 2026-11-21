import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 徽章色调。 */
export type BadgeTone = "neutral" | "business" | "ok" | "warn" | "err";

const BADGE_CLASS: Record<BadgeTone, string> = {
  neutral: "dsu-badge dsu-badgeNeutral",
  business: "dsu-badge dsu-badgeBusiness",
  ok: "dsu-badge dsu-badgeOk",
  warn: "dsu-badge dsu-badgeWarn",
  err: "dsu-badge dsu-badgeErr",
};

/** 圆角徽章：CLI 档位、实验标记、脏态计数这一类短状态。 */
export function Badge(props: { tone?: BadgeTone | undefined; children?: ReactNode }): ReactElement {
  return createElement("span", { className: BADGE_CLASS[props.tone ?? "neutral"] }, props.children);
}

/** 状态点色调。 */
export type DotTone = "ok" | "warn" | "err" | "mute";

const DOT_CLASS: Record<DotTone, string> = {
  ok: "dsu-dot dsu-dotOk",
  warn: "dsu-dot dsu-dotWarn",
  err: "dsu-dot dsu-dotErr",
  mute: "dsu-dot dsu-dotMute",
};

/** 语义状态点：只表达状态，不带文字。 */
export function StatusDot(props: { tone?: DotTone | undefined }): ReactElement {
  return createElement("span", {
    className: DOT_CLASS[props.tone ?? "mute"],
    "aria-hidden": true,
  });
}
