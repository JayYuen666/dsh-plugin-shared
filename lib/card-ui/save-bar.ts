/// <reference lib="dom" />
import { createElement } from "react";
import type { ReactElement } from "react";

/** 底部保存条：dirty 或越界时吸底，显示条数与失败原因。
 *
 *  `blocked` 与 `dirty` 是两件事，不是重复：`dirty` 是「已提交值之外还有草稿」，
 *  `blocked` 是「其中有的草稿过不了校验、写不进去」。把两者并成一个 `disabled` 会在两头各坏一半：
 *  - 把越界算进 `dirty` 的卡片：保存按钮亮着，点下去被调用方自己的早退挡掉，
 *    **界面上什么也不会发生**；
 *  - 只按真实改动算 `dirty` 的卡片：越界时两个按钮都灰着，而状态行正写着
 *    「先修正或撤销后再保存」——**撤销也是灰的**，用户唯一的出路是手动把数字改回合法值。
 *  所以：`blocked` 只拦保存、不拦撤销（撤销正是那条出路），并且越界本身也吸底（那条提示得看得见）。 */
export function SaveBar(props: {
  dirty: boolean;
  busy: boolean;
  writable: boolean;
  error: string | null;
  /** 有字段越界、这批草稿写不进去。缺省 false（不传就是原来那套行为）。 */
  blocked?: boolean;
  saveLabel: string;
  savingLabel: string;
  revertLabel: string;
  dirtyLabel: string;
  cleanLabel: string;
  readOnlyLabel: string;
  onSave: () => void;
  onDiscard: () => void;
}): ReactElement {
  const blocked = props.blocked === true;
  const locked = !props.writable || props.busy;
  // 撤销的门槛比保存低一档：只要还有东西可退（改动或越界草稿），它就是那条出路。
  const saveDisabled = locked || !props.dirty || blocked;
  const discardDisabled = locked || (!props.dirty && !blocked);
  let status: string;
  if (props.error !== null) {
    status = props.error;
  } else if (props.writable) {
    status = props.cleanLabel;
  } else {
    status = props.readOnlyLabel;
  }
  // 脏态左侧是计数胶囊 + （有错时）红色错误字；干净/只读态是普通状态字。
  // 只有越界草稿、没有真实改动时不画计数胶囊——胶囊写着「N 项」而 N=0 是自相矛盾，
  // 越界说明已经由状态字/错误行承担。
  const dirty = props.dirty || blocked;
  const left = props.dirty
    ? createElement("span", { role: "status", className: "dsu-dirtyPill" }, props.dirtyLabel)
    : createElement(
        "span",
        {
          role: "status",
          className: props.error === null ? "dsu-status" : "dsu-status dsu-statusError",
        },
        status,
      );
  return createElement(
    "div",
    { className: "dsu-savebar", "data-dirty": dirty },
    left,
    props.dirty && props.error !== null
      ? createElement("span", { className: "dsu-status dsu-statusError" }, props.error)
      : null,
    createElement(
      "button",
      {
        type: "button",
        className: "dsu-btn",
        "data-field": "discard",
        disabled: discardDisabled,
        onClick: props.onDiscard,
      },
      props.revertLabel,
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "dsu-btn dsu-btnPrimary",
        "data-field": "save",
        disabled: saveDisabled,
        onClick: props.onSave,
      },
      props.busy ? props.savingLabel : props.saveLabel,
    ),
  );
}
