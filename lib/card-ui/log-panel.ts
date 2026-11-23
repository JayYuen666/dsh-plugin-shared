import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StatusDot } from "./badge.ts";
import type { DotTone } from "./badge.ts";

/** 日志面板头部的一个动作按钮。 */
export interface LogPanelAction {
  label: string;
  onClick: () => void;
}

/** 只在点击时碰的剪贴板面：不把 DOM 类型带进 Node 侧编译。 */
interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

function clipboardOf(): ClipboardLike | undefined {
  return (globalThis as { navigator?: { clipboard?: ClipboardLike } }).navigator?.clipboard;
}

/** 行内语义色：只按日志行里明确的状态词着色，不做关键词装饰。 */
const LOG_LINE_CLASS = {
  ok: "dsu-logOk",
  warn: "dsu-logWarn",
  err: "dsu-logErr",
} as const;

/** 语义词表。命令型原文默认不启用，由调用方显式打开 `semanticLines`。 */
const LOG_ERR_LINE =
  /^\s*(?:error|errors|failed|failure|fatal|denied|refused)(?=[\s:–-]|$)|错误|失败|异常|拒绝/iu;
const LOG_WARN_LINE =
  /^\s*(?:warn|warning|warnings|skip|skipped|deprecated)(?=[\s:–-]|$)|警告|跳过|弃用|未完成|未就绪/iu;
const LOG_OK_LINE =
  /^\s*(?:ok|success|successful|successfully|done|completed|finished)(?=[\s:–-]|$)|完成|成功|已登记|已索引|就绪/iu;
const LOG_LINE_PREFIX = /^\s*(?:\[[^\]]*\]\s*)+/u;

/**
 * 一行日志的语气。宁可漏判也不把路径里的 `error` 当成失败：先剥掉行首时间戳/方括号，
 * 再看明确的词；仍保留任意位置的中文状态词（中文日志常写成「索引完成」）。
 */
function logLineTone(line: string): keyof typeof LOG_LINE_CLASS | undefined {
  const body = line.replace(LOG_LINE_PREFIX, "");
  if (LOG_ERR_LINE.test(body)) {
    return "err";
  }
  if (LOG_WARN_LINE.test(body)) {
    return "warn";
  }
  return LOG_OK_LINE.test(body) ? "ok" : undefined;
}

/** 把字符串正文按行包成语义色 span；非字符串 children 原样交给 React。 */
function semanticLogText(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (index > 0) {
      nodes.push("\n");
    }
    const tone = logLineTone(line);
    nodes.push(
      tone === undefined
        ? line
        : createElement(
            "span",
            { key: `log-line-${index}`, className: LOG_LINE_CLASS[tone] },
            line,
          ),
    );
  }
  return nodes;
}

/** 日志 / 输出面板：命令输出、作业日志、重建回执这一类等宽文本面。 */
export function LogPanel(props: {
  /** 头部说明（含时间、作业号等）；无头部内容时不渲染头部。 */
  label?: ReactNode;
  tone?: DotTone | undefined;
  actions?: readonly LogPanelAction[] | undefined;
  /** 对字符串正文按行做语义着色；命令型原文默认不启用，由日志类调用方显式打开。 */
  semanticLines?: boolean | undefined;
  /** 命令型输出：给了这两段就在头部生一个复制动作。 */
  copyText?: string | undefined;
  copyLabel?: string | undefined;
  copiedLabel?: string | undefined;
  children?: ReactNode;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const copyAction =
    props.copyText === undefined || props.copyLabel === undefined
      ? null
      : {
          label: copied ? (props.copiedLabel ?? props.copyLabel) : props.copyLabel,
          onClick: (): void => {
            const clipboard = clipboardOf();
            const write = clipboard?.writeText;
            const text = props.copyText;
            if (write === undefined || clipboard === undefined || text === undefined) {
              return;
            }
            void (async (): Promise<void> => {
              try {
                await write.call(clipboard, text);
                setCopied(true);
              } catch {
                // 剪贴板被浏览器拒绝时保持原标签：不谎报「已复制」。
              }
            })();
          },
        };
  const actions = [...(props.actions ?? []), ...(copyAction === null ? [] : [copyAction])];
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
    createElement(
      "pre",
      { className: "dsu-logBody" },
      props.semanticLines === true && typeof props.children === "string"
        ? semanticLogText(props.children)
        : props.children,
    ),
  );
}
