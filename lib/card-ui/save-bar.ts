/// <reference lib="dom" />
import { createElement } from "react";
import type { ReactElement } from "react";

/** 底部保存条：dirty 时吸底，显示条数与失败原因。 */
export function SaveBar(props: {
  dirty: boolean;
  busy: boolean;
  writable: boolean;
  error: string | null;
  saveLabel: string;
  savingLabel: string;
  revertLabel: string;
  dirtyLabel: string;
  cleanLabel: string;
  readOnlyLabel: string;
  onSave: () => void;
  onDiscard: () => void;
}): ReactElement {
  const disabled = !props.writable || props.busy || !props.dirty;
  let status: string;
  if (props.error !== null) {
    status = props.error;
  } else if (props.writable) {
    status = props.dirty ? props.dirtyLabel : props.cleanLabel;
  } else {
    status = props.readOnlyLabel;
  }
  return createElement(
    "div",
    { className: "dsu-savebar", "data-dirty": props.dirty },
    createElement(
      "button",
      {
        type: "button",
        className: "dsu-btn dsu-btnPrimary",
        "data-field": "save",
        disabled,
        onClick: props.onSave,
      },
      props.busy ? props.savingLabel : props.saveLabel,
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "dsu-btn",
        "data-field": "discard",
        disabled,
        onClick: props.onDiscard,
      },
      props.revertLabel,
    ),
    createElement(
      "span",
      { className: props.error === null ? "dsu-status" : "dsu-status dsu-statusError" },
      status,
    ),
  );
}
