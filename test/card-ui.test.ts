// @vitest-environment happy-dom
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import type { ReactElement } from "react";
import {
  CARD_UI_CSS,
  CardForm,
  Field,
  FieldGrid,
  InfoTip,
  ListField,
  NumberField,
  SaveBar,
  Section,
  SelectField,
  StatusBar,
  TextField,
  ToggleField,
  splitHint,
} from "../lib/card-ui.ts";
import { click, fire, mount, noop, textOf, typeInto } from "./card-ui-helpers.ts";

describe("card-ui 样式表", () => {
  it("包含行式字段、开关、下拉与保存条的关键规则", () => {
    for (const needle of [
      ".dsu-field",
      "grid-template-columns:minmax(0,1fr) minmax(240px,360px)",
      ".dsu-switch",
      ".dsu-menu",
      ".dsu-savebar",
      "@media (max-width:640px)",
    ]) {
      assert.ok(CARD_UI_CSS.includes(needle), `缺少规则：${needle}`);
    }
  });

  it("颜色只引用主题令牌", () => {
    assert.ok(!/#[0-9a-f]{3,8}/iu.test(CARD_UI_CSS), "样式表里不得写死十六进制颜色");
  });
});

describe("splitHint", () => {
  it("不超过阈值时作为常显提示", () => {
    assert.deepEqual(splitHint("留空跟随会话模型。"), { hint: "留空跟随会话模型。" });
  });

  it("超过阈值时只作为浮层详情", () => {
    const long = "这不是一句能在行内放下的话，因为它确实超过了三十个字符的上限。";
    assert.deepEqual(splitHint(long), { detail: long });
  });

  it("恰好等于阈值仍然常显", () => {
    const exact = "一".repeat(30);
    assert.deepEqual(splitHint(exact), { hint: exact });
  });

  it("支持自定义阈值", () => {
    assert.deepEqual(splitHint("abcdef", 3), { detail: "abcdef" });
  });
});

describe("布局组件", () => {
  it("cardForm 渲染无外框容器", async () => {
    const view = await mount(createElement(CardForm, null, createElement("span", null, "x")));
    const root = view.container.querySelector(".dsu-form");
    assert.ok(root);
    assert.equal(root.children.length, 1);
    await view.unmount();
  });

  it("section 渲染标题、可选说明与子节点", async () => {
    const view = await mount(
      createElement(
        Section,
        { title: "门禁", hint: "一句话" },
        createElement("div", null, "field"),
      ),
    );
    assert.equal(textOf(view.container, ".dsu-sectionTitle"), "门禁");
    assert.equal(textOf(view.container, ".dsu-sectionHint"), "一句话");
    assert.equal(textOf(view.container, "div"), "field");
    await view.unmount();
  });

  it("section 无说明时不渲染说明节点", async () => {
    const view = await mount(createElement(Section, { title: "门禁" }));
    assert.equal(view.container.querySelector(".dsu-sectionHint"), null);
    await view.unmount();
  });

  it("fieldGrid 与 StatusBar 渲染", async () => {
    const view = await mount(
      createElement(
        "div",
        null,
        createElement(FieldGrid, null, createElement("span", null, "a")),
        createElement(StatusBar, { items: ["候选 1", "生效 2"] }),
      ),
    );
    assert.equal(textOf(view.container, ".dsu-grid"), "a");
    assert.equal(textOf(view.container, ".dsu-statusbar"), "候选 1· 生效 2");
    await view.unmount();
  });

  it("statusBar 空清单不渲染节点", async () => {
    const view = await mount(createElement(StatusBar, { items: [] }));
    assert.equal(view.container.querySelector(".dsu-statusbar"), null);
    await view.unmount();
  });
});

describe("field 与说明浮层", () => {
  it("field 渲染标签、提示与控件", async () => {
    const view = await mount(
      createElement(Field, { label: "启用", hint: "一句话" }, createElement("button", null, "ctl")),
    );
    assert.equal(textOf(view.container, ".dsu-label"), "启用");
    assert.equal(textOf(view.container, ".dsu-hint"), "一句话");
    assert.equal(textOf(view.container, ".dsu-control"), "ctl");
    await view.unmount();
  });

  it("field 无提示时不渲染提示节点，wide 加整宽类", async () => {
    const view = await mount(createElement(Field, { label: "启用", wide: true }));
    assert.equal(view.container.querySelector(".dsu-hint"), null);
    assert.ok(view.container.querySelector(".dsu-fieldWide"));
    await view.unmount();
  });

  it("infoTip 悬停显示、离开延迟隐藏", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    assert.equal(tip.hidden, true);
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    assert.equal(tip.hidden, false);
    assert.equal(tip.textContent, "完整说明");
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    assert.equal(tip.hidden, true);
    vi.useRealTimers();
    await view.unmount();
  });

  it("点击钉住后离开不隐藏，Esc 关闭", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await click(btn);
    assert.equal(tip.hidden, false);
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    assert.equal(tip.hidden, false);
    await fire(document, new KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(tip.hidden, true);
    await view.unmount();
  });

  it("聚焦显示、失焦延迟隐藏", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new FocusEvent("focusin", { bubbles: true }));
    assert.equal(tip.hidden, false);
    await fire(wrap, new FocusEvent("focusout", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    assert.equal(tip.hidden, true);
    vi.useRealTimers();
    await view.unmount();
  });

  it("滚动关闭未钉住的浮层，resize 保持显示", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(globalThis, new Event("resize"));
    assert.equal(tip.hidden, false);
    await fire(globalThis, new Event("scroll"));
    assert.equal(tip.hidden, true);
    await view.unmount();
  });

  it("卸载时清理未触发的隐藏定时器", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await view.unmount();
    assert.equal(vi.getTimerCount(), 0);
    vi.useRealTimers();
  });
});

describe("输入字段", () => {
  it("toggleField 点击取反并透传 data-field", async () => {
    let next: boolean | null = null;
    const view = await mount(
      createElement(ToggleField, {
        label: "启用",
        field: "enabled",
        checked: true,
        onChange: (value: boolean) => {
          next = value;
        },
      }),
    );
    const sw = view.container.querySelector<HTMLButtonElement>(".dsu-switch")!;
    assert.equal(sw.getAttribute("aria-checked"), "true");
    assert.equal(sw.dataset["field"], "enabled");
    await click(sw);
    assert.equal(next, false);
    await view.unmount();
  });

  it("toggleField 禁用时不触发", async () => {
    let called = false;
    const view = await mount(
      createElement(ToggleField, {
        label: "启用",
        checked: false,
        disabled: true,
        onChange: () => {
          called = true;
        },
      }),
    );
    const sw = view.container.querySelector<HTMLButtonElement>(".dsu-switch")!;
    assert.equal(sw.disabled, true);
    await click(sw);
    assert.equal(called, false);
    await view.unmount();
  });

  it("numberField 合法值写回、越界显示错误、清空回 undefined", async () => {
    const seen: (number | undefined)[] = [];
    const view = await mount(
      createElement(NumberField, {
        label: "预算",
        field: "budget",
        value: 10,
        min: 1,
        max: 20,
        step: 1,
        unit: "秒",
        invalidHint: "越界",
        onChange: (value: number | undefined): void => {
          seen.push(value);
        },
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.min, "1");
    assert.equal(input.max, "20");
    assert.equal(input.step, "1");
    assert.equal(textOf(view.container, ".dsu-unit"), "秒");
    await typeInto(input, "12");
    assert.deepEqual(seen, [12]);
    await typeInto(input, "99");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(textOf(view.container, ".dsu-error"), "越界");
    await typeInto(input, "");
    assert.deepEqual(seen, [12, undefined]);
    assert.equal(input.getAttribute("aria-invalid"), null);
    await view.unmount();
  });

  it("numberField 外部值与禁用态同步", async () => {
    const view = await mount(
      createElement(NumberField, {
        label: "预算",
        value: 10,
        invalidHint: "越界",
        onChange: noop,
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await view.render(
      createElement(NumberField, {
        label: "预算",
        value: 30,
        disabled: true,
        invalidHint: "越界",
        onChange: noop,
      }),
    );
    assert.equal(input.value, "30");
    assert.equal(input.disabled, true);
    await view.unmount();
  });

  it("textField 聚焦期间不被外部值覆盖", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(TextField, {
        label: "地址",
        value: "a",
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await fire(input, new FocusEvent("focusin", { bubbles: true }));
    await typeInto(input, "b");
    assert.deepEqual(seen, ["b"]);
    await view.render(
      createElement(TextField, {
        label: "地址",
        value: "c",
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    assert.equal(input.value, "b");
    await fire(input, new FocusEvent("focusout", { bubbles: true }));
    await view.render(
      createElement(TextField, {
        label: "地址",
        value: "d",
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    assert.equal(input.value, "d");
    await view.unmount();
  });

  it("textField 多行与等宽", async () => {
    const view = await mount(
      createElement(TextField, {
        label: "正文",
        value: "x",
        multiline: true,
        monospace: true,
        onChange: noop,
      }),
    );
    const area = view.container.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.ok(area.classList.contains("dsu-textarea"));
    assert.ok(area.classList.contains("dsu-mono"));
    await view.unmount();
  });

  it("listField 逗号分隔", async () => {
    const seen: string[][] = [];
    const view = await mount(
      createElement(ListField, {
        label: "名单",
        value: [],
        separator: "comma",
        onChange: (value: string[]): void => {
          seen.push(value);
        },
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input, "a, b ,c");
    assert.deepEqual(seen.at(-1), ["a", "b", "c"]);
    await view.unmount();
  });

  it("listField 换行分隔", async () => {
    const seen: string[][] = [];
    const view = await mount(
      createElement(ListField, {
        label: "正则",
        value: ["a"],
        separator: "newline",
        onChange: (value: string[]): void => {
          seen.push(value);
        },
      }),
    );
    const area = view.container.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.equal(area.value, "a");
    await typeInto(area, "a\nb\n");
    assert.deepEqual(seen.at(-1), ["a", "b"]);
    await view.unmount();
  });
});

describe("selectField", () => {
  const options = [
    { value: "a", label: "甲" },
    { value: "b", label: "乙" },
    { value: "c", label: "丙", disabled: true },
  ];

  it("打开、键盘移动、回车选中", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        field: "kind",
        value: "a",
        options,
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    assert.equal(menu.hidden, false);
    await fire(trigger, new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await fire(trigger, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(seen, ["b"]);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("选中项显示勾，禁用项不可选", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    const opts = [...view.container.querySelectorAll(".dsu-option")] as HTMLButtonElement[];
    assert.equal(opts[0]?.getAttribute("aria-selected"), "true");
    assert.equal(opts[1]?.getAttribute("aria-selected"), "false");
    assert.equal(opts[2]?.disabled, true);
    await view.unmount();
  });

  it("点外部关闭，Esc 关闭", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await fire(document.body, new MouseEvent("pointerdown", { bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("空选项时触发器不可展开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "",
        options: [],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    assert.equal(trigger.disabled, true);
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("分组选项渲染组标题，键盘跳过禁用项", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "模型",
        value: "a",
        options: [
          { value: "a", label: "甲", group: "本地" },
          { value: "b", label: "乙", group: "本地", disabled: true },
          { value: "c", label: "丙", group: "远端" },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    assert.equal(view.container.querySelectorAll(".dsu-optionGroup").length, 2);
    await fire(trigger, new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const active = view.container.querySelector<HTMLElement>('.dsu-option[data-active="true"]')!;
    assert.equal(active.textContent, "丙");
    await view.unmount();
  });

  it("home/End 与空格选中", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await fire(trigger, new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await fire(trigger, new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    assert.deepEqual(seen, ["a"]);
    await view.unmount();
  });

  it("鼠标悬停改 active，点击选项选中", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    const opts = [...view.container.querySelectorAll(".dsu-option")] as HTMLButtonElement[];
    await fire(opts[1]!, new MouseEvent("mouseover", { bubbles: true }));
    assert.equal(opts[1]?.dataset["active"], "true");
    await click(opts[1]);
    assert.deepEqual(seen, ["b"]);
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "b",
        options,
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    assert.equal(trigger.textContent.includes("乙"), true);
    await view.unmount();
  });

  it("滚动关闭、resize 保持展开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await fire(globalThis, new Event("resize"));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await fire(globalThis, new Event("scroll"));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("值不在选项里时触发器回退显示原值", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "zzz",
        options,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    assert.equal(trigger.textContent.includes("zzz"), true);
    await view.unmount();
  });

  it("全部禁用时不可展开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲", disabled: true }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("disabled 属性阻止展开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        disabled: true,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    assert.equal(trigger.disabled, true);
    await fire(trigger, new MouseEvent("click", { bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("空间不足时翻到上方并右移", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    trigger.getBoundingClientRect = () => ({
      x: globalThis.innerWidth,
      y: 760,
      left: globalThis.innerWidth,
      top: 760,
      right: globalThis.innerWidth + 300,
      bottom: 768,
      width: 300,
      height: 8,
      toJSON: noop,
    });
    await click(trigger);
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    assert.equal(menu.style.width, "300px");
    assert.equal(menu.style.top, "754px");
    assert.equal(menu.style.left, `${globalThis.innerWidth - 300 - 8}px`);
    await view.unmount();
  });

  it("选项缩短后活动项回退到首个可用项", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "c",
        options,
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "c",
        options: [{ value: "a", label: "甲" }],
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const active = view.container.querySelector<HTMLElement>('[data-active="true"]')!;
    assert.equal(active.id, trigger.getAttribute("aria-activedescendant"));
    await fire(trigger, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(seen, ["a"]);
    await view.unmount();
  });

  it("active 变成禁用后回退到首个可用项", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲", disabled: true },
          { value: "b", label: "乙" },
        ],
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const active = view.container.querySelector<HTMLElement>('[data-active="true"]')!;
    assert.equal(active.textContent, "乙");
    await fire(trigger, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(seen, ["b"]);
    await view.unmount();
  });

  it("全部选项在打开后禁用时方向键不移动", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲", disabled: true },
          { value: "b", label: "乙", disabled: true },
        ],
        onChange: noop,
      }),
    );
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options,
        disabled: true,
        onChange: noop,
      }),
    );
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });
});

describe("saveBar", () => {
  const labels = {
    saveLabel: "保存",
    savingLabel: "保存中",
    revertLabel: "撤销",
    dirtyLabel: "已修改 2 项",
    cleanLabel: "无未保存的修改",
    readOnlyLabel: "只读",
  };

  it("dirty 时吸底、按钮可用", async () => {
    let saved = 0;
    let reverted = 0;
    const view = await mount(
      createElement(SaveBar, {
        ...labels,
        dirty: true,
        busy: false,
        writable: true,
        error: null,
        onSave: () => {
          saved += 1;
        },
        onDiscard: () => {
          reverted += 1;
        },
      }),
    );
    const bar = view.container.querySelector<HTMLElement>(".dsu-savebar")!;
    assert.equal(bar.dataset["dirty"], "true");
    assert.equal(textOf(view.container, ".dsu-status"), "已修改 2 项");
    const buttons = [...view.container.querySelectorAll("button")] as HTMLButtonElement[];
    await click(buttons[0]!);
    await click(buttons[1]!);
    assert.equal(saved, 1);
    assert.equal(reverted, 1);
    await view.unmount();
  });

  it("clean 时不吸底、按钮禁用", async () => {
    const view = await mount(
      createElement(SaveBar, {
        ...labels,
        dirty: false,
        busy: false,
        writable: true,
        error: null,
        onSave: noop,
        onDiscard: noop,
      }),
    );
    const bar = view.container.querySelector<HTMLElement>(".dsu-savebar")!;
    assert.equal(bar.dataset["dirty"], "false");
    assert.equal(textOf(view.container, ".dsu-status"), "无未保存的修改");
    const buttons = [...view.container.querySelectorAll("button")] as HTMLButtonElement[];
    assert.equal(buttons[0]!.disabled, true);
    assert.equal(buttons[1]!.disabled, true);
    await view.unmount();
  });

  it("只读显示只读文案", async () => {
    const view = await mount(
      createElement(SaveBar, {
        ...labels,
        dirty: false,
        busy: false,
        writable: false,
        error: null,
        onSave: noop,
        onDiscard: noop,
      }),
    );
    assert.equal(textOf(view.container, ".dsu-status"), "只读");
    await view.unmount();
  });

  it("错误优先显示并带错误类", async () => {
    const view = await mount(
      createElement(SaveBar, {
        ...labels,
        dirty: true,
        busy: false,
        writable: false,
        error: "写入失败",
        onSave: noop,
        onDiscard: noop,
      }),
    );
    const status = view.container.querySelector<HTMLElement>(".dsu-status")!;
    assert.equal(status.textContent, "写入失败");
    assert.ok(status.classList.contains("dsu-statusError"));
    await view.unmount();
  });

  it("busy 时按钮显示保存中并禁用", async () => {
    const view = await mount(
      createElement(SaveBar, {
        ...labels,
        dirty: true,
        busy: true,
        writable: true,
        error: null,
        onSave: noop,
        onDiscard: noop,
      }),
    );
    const buttons = [...view.container.querySelectorAll("button")] as HTMLButtonElement[];
    assert.equal(buttons[0]?.textContent, "保存中");
    assert.equal(buttons[0].disabled, true);
    await view.unmount();
  });
});

describe("卡片边界交互", () => {
  it("InfoTip 空间不足时翻到上方并左移", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    btn.getBoundingClientRect = () => new DOMRect(globalThis.innerWidth, 760, 16, 8);
    await fire(globalThis, new Event("resize"));
    assert.equal(tip.style.top, "752px");
    assert.equal(tip.style.left, `${globalThis.innerWidth - 8}px`);
    await view.unmount();
  });

  it("关闭状态下滚动/缩放/Esc 不改变状态", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(globalThis, new Event("scroll"));
    await fire(globalThis, new Event("resize"));
    await fire(document, new KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(tip.hidden, true);
    await view.unmount();
  });

  it("离开后重新悬停会取消隐藏定时器", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    assert.equal(tip.hidden, false);
    vi.useRealTimers();
    await view.unmount();
  });

  it("再次点击说明按钮取消钉住", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await click(btn);
    assert.equal(tip.hidden, false);
    await click(btn);
    assert.equal(tip.hidden, true);
    await view.unmount();
  });

  it("Field 带 detail 时渲染说明按钮", async () => {
    const view = await mount(
      createElement(Field, { label: "启用", detail: "说明" }, createElement("span", null, "x")),
    );
    assert.ok(view.container.querySelector(".dsu-helpBtn"));
    await view.unmount();
  });

  it("Field 紧凑模式使用等宽标签", async () => {
    const view = await mount(
      createElement(
        Field,
        { label: "scrapling_fetch", compact: true },
        createElement("span", null, "x"),
      ),
    );
    const label = view.container.querySelector<HTMLElement>(".dsu-label")!;
    assert.ok(label.classList.contains("dsu-labelMono"));
    await view.unmount();
  });

  it("NumberField 空值与无边界时接受任意有限数", async () => {
    const seen: (number | undefined)[] = [];
    const view = await mount(
      createElement(NumberField, {
        label: "预算",
        value: undefined,
        invalidHint: "越界",
        onChange: (value: number | undefined): void => {
          seen.push(value);
        },
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.value, "");
    await typeInto(input, "5");
    assert.deepEqual(seen, [5]);
    await view.unmount();
  });

  it("NumberField 无单位时不渲染后缀", async () => {
    const view = await mount(
      createElement(NumberField, {
        label: "预算",
        value: 1,
        invalidHint: "越界",
        onChange: noop,
      }),
    );
    assert.equal(view.container.querySelector(".dsu-unit"), null);
    await view.unmount();
  });

  it("TextField 单行等宽", async () => {
    const view = await mount(
      createElement(TextField, {
        label: "路径",
        value: "x",
        monospace: true,
        onChange: noop,
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    assert.ok(input.classList.contains("dsu-mono"));
    assert.ok(!input.classList.contains("dsu-textarea"));
    await view.unmount();
  });

  it("ListField 聚焦期间不被外部值覆盖，失焦后同步", async () => {
    const view = await mount(
      createElement(ListField, {
        label: "名单",
        value: ["a"],
        onChange: noop,
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await fire(input, new FocusEvent("focusin", { bubbles: true }));
    await view.render(
      createElement(ListField, {
        label: "名单",
        value: ["b"],
        onChange: noop,
      }),
    );
    assert.equal(input.value, "a");
    await fire(input, new FocusEvent("focusout", { bubbles: true }));
    await view.render(
      createElement(ListField, {
        label: "名单",
        value: ["c"],
        onChange: noop,
      }),
    );
    assert.equal(input.value, "c");
    await view.unmount();
  });

  it.each(["ArrowDown", "ArrowUp", "Home", "Enter"])("SelectField 关闭时 %s 打开", async (key) => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙" },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await fire(trigger, new KeyboardEvent("keydown", { key, bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "true", key);
    await view.unmount();
  });

  it("SelectField 上下键在候选项间移动", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙" },
        ],
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await fire(trigger, new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await fire(trigger, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(seen, ["a"]);
    await view.unmount();
  });

  it("SelectField Esc 关闭，其它按键不关闭", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await fire(trigger, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("SelectField 在菜单/触发器上按下不关闭", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    await click(trigger);
    await fire(menu, new MouseEvent("pointerdown", { bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await fire(trigger, new MouseEvent("pointerdown", { bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await view.unmount();
  });

  it("SelectField 悬停禁用项不改变 active", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙", disabled: true },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    const opts = [...view.container.querySelectorAll<HTMLButtonElement>(".dsu-option")];
    await fire(opts[1]!, new MouseEvent("mouseover", { bubbles: true }));
    assert.equal(opts[0]?.dataset["active"], "true");
    const seen: string[] = [];
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙", disabled: true },
        ],
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    await click(opts[1]!);
    assert.deepEqual(seen, []);
    await view.unmount();
  });

  it("SelectField 关闭状态下滚动/缩放不展开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await fire(globalThis, new Event("scroll"));
    await fire(globalThis, new Event("resize"));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("SelectField 打开后全部禁用时按键不再展开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙" },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await view.render(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲", disabled: true },
          { value: "b", label: "乙", disabled: true },
        ],
        onChange: noop,
      }),
    );
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await fire(trigger, new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("SelectField 再点触发器关闭", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });
});

/** 受控数字字段：父组件同步回写 value，用于验证草稿不被回写打断。 */
function ControlledNumber(): ReactElement {
  const [value, setValue] = useState<number | undefined>(1);
  return createElement(NumberField, {
    label: "数字",
    value,
    invalidHint: "越界",
    onChange: (next: number | undefined): void => {
      setValue(next);
    },
  });
}

describe("评审修复", () => {
  it("聚焦时鼠标移出不会关闭，失焦后才关闭", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new FocusEvent("focusin", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    assert.equal(tip.hidden, false);
    await fire(wrap, new FocusEvent("focusout", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    assert.equal(tip.hidden, true);
    vi.useRealTimers();
    await view.unmount();
  });

  it("悬停时失焦不会关闭，移出后才关闭", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new FocusEvent("focusin", { bubbles: true }));
    await fire(wrap, new FocusEvent("focusout", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    assert.equal(tip.hidden, false);
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    assert.equal(tip.hidden, true);
    vi.useRealTimers();
    await view.unmount();
  });

  it("连续离开/失焦只保留一个隐藏计时器", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await fire(wrap, new FocusEvent("focusin", { bubbles: true }));
    await fire(wrap, new FocusEvent("focusout", { bubbles: true }));
    assert.equal(vi.getTimerCount(), 1);
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    assert.equal(tip.hidden, true);
    vi.useRealTimers();
    await view.unmount();
  });

  it("等待关闭期间重新悬停会取消计时器", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    assert.equal(tip.hidden, false);
    vi.useRealTimers();
    await view.unmount();
  });

  it("等待关闭期间点击钉住不会被旧计时器关掉", async () => {
    vi.useFakeTimers();
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new MouseEvent("mouseover", { bubbles: true }));
    await fire(wrap, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await click(btn);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    assert.equal(tip.hidden, false);
    vi.useRealTimers();
    await view.unmount();
  });

  it("钉住后滚动仍跟随按钮", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await click(btn);
    btn.getBoundingClientRect = () => new DOMRect(20, 30, 16, 8);
    await fire(globalThis, new Event("scroll"));
    assert.equal(tip.style.left, "20px");
    assert.equal(tip.style.top, "46px");
    await view.unmount();
  });

  it("滚动浮层自身不会关闭", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await click(btn);
    await fire(tip, new Event("scroll", { bubbles: true }));
    assert.equal(tip.hidden, false);
    await view.unmount();
  });

  it("打开期间 detail 变化会重新定位", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "旧说明" }));
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await click(btn);
    btn.getBoundingClientRect = () => new DOMRect(10, 10, 16, 8);
    await view.render(createElement(InfoTip, { label: "启用", detail: "新说明" }));
    assert.equal(tip.style.left, "10px");
    assert.equal(tip.style.top, "26px");
    await view.unmount();
  });

  it("失焦到组件内部不关闭", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const wrap = view.container.querySelector<HTMLElement>(".dsu-help")!;
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await fire(wrap, new FocusEvent("focusin", { bubbles: true }));
    assert.equal(tip.hidden, false);
    await fire(wrap, new FocusEvent("focusout", { bubbles: true, relatedTarget: btn }));
    assert.equal(tip.hidden, false);
    await view.unmount();
  });

  it("InfoTip showLabel=false 不渲染重复字段名", async () => {
    const view = await mount(
      createElement(InfoTip, { label: "启用", detail: "完整说明", showLabel: false }),
    );
    assert.equal(view.container.querySelector(".dsu-label"), null);
    assert.ok(view.container.querySelector(".dsu-helpBtn"));
    await view.unmount();
  });

  it("Field 用 controlId 建立 label 关联并给 hint 分配 id", async () => {
    const view = await mount(
      createElement(
        Field,
        { label: "用户名", controlId: "ctl-user", hint: "一行提示" },
        createElement("input", { id: "ctl-user" }),
      ),
    );
    const label = view.container.querySelector<HTMLLabelElement>("label")!;
    const hint = view.container.querySelector<HTMLElement>(".dsu-hint")!;
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    assert.equal(label.htmlFor, "ctl-user");
    assert.equal(label.textContent, "用户名");
    assert.equal(hint.id, "ctl-user-hint");
    assert.equal(input.id, "ctl-user");
    await view.unmount();
  });

  it("Field 带 detail 与 compact 时标签仍只有一份并保留等宽类", async () => {
    const view = await mount(
      createElement(
        Field,
        { label: "scrapling_fetch", detail: "说明", compact: true, controlId: "ctl-x" },
        createElement("span", null, "x"),
      ),
    );
    const labels = view.container.querySelectorAll(".dsu-label");
    assert.equal(labels.length, 1);
    const [label] = labels;
    assert.ok(label);
    assert.equal(label.classList.contains("dsu-labelMono"), true);
    assert.equal(label.textContent, "scrapling_fetch");
    await view.unmount();
  });

  it("控件 id 与描述关联（开关/数字/下拉）", async () => {
    const view = await mount(
      createElement(
        "div",
        null,
        createElement(ToggleField, {
          label: "开关",
          hint: "提示",
          checked: true,
          onChange: noop,
        }),
        createElement(NumberField, {
          label: "数字",
          hint: "范围",
          value: 1,
          invalidHint: "越界",
          onChange: noop,
        }),
        createElement(SelectField, {
          label: "下拉",
          hint: "选择",
          value: "a",
          options: [{ value: "a", label: "甲" }],
          onChange: noop,
        }),
      ),
    );
    const controls = [
      view.container.querySelector<HTMLButtonElement>(".dsu-switch")!,
      view.container.querySelector<HTMLInputElement>("input")!,
      view.container.querySelector<HTMLButtonElement>(".dsu-select")!,
    ];
    for (const control of controls) {
      assert.ok(control.id !== "");
      assert.equal(control.getAttribute("aria-describedby"), `${control.id}-hint`);
      const label = view.container.querySelector<HTMLLabelElement>(`label[for="${control.id}"]`);
      assert.ok(label, control.id);
    }
    await view.unmount();
  });

  it("NumberField 越界时 aria-describedby 同时包含提示与错误", async () => {
    const view = await mount(
      createElement(NumberField, {
        label: "预算",
        hint: "范围提示",
        value: 1,
        min: 1,
        max: 10,
        invalidHint: "越界",
        onChange: noop,
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input, "99");
    const describedBy = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    assert.equal(describedBy.length, 2);
    assert.ok(describedBy.includes(`${input.id}-hint`));
    const error = view.container.querySelector<HTMLElement>(".dsu-error")!;
    assert.equal(describedBy[1], error.id);
    await view.unmount();
  });

  it("打开时按非 Esc 键不关闭", async () => {
    const view = await mount(createElement(InfoTip, { label: "启用", detail: "完整说明" }));
    const btn = view.container.querySelector<HTMLButtonElement>(".dsu-helpBtn")!;
    const tip = view.container.querySelector<HTMLElement>(".dsu-tip")!;
    await click(btn);
    await fire(document, new KeyboardEvent("keydown", { key: "Tab" }));
    assert.equal(tip.hidden, false);
    await view.unmount();
  });

  it("InfoTip compact 标签保留等宽类", async () => {
    const view = await mount(
      createElement(InfoTip, { label: "scrapling_fetch", detail: "说明", compact: true }),
    );
    const label = view.container.querySelector<HTMLElement>(".dsu-label")!;
    assert.ok(label.classList.contains("dsu-labelMono"));
    assert.equal(label.textContent, "scrapling_fetch");
    await view.unmount();
  });

  it("TextField 与 ListField 也把 hint 关联到控件", async () => {
    const view = await mount(
      createElement(
        "div",
        null,
        createElement(TextField, {
          label: "文本",
          hint: "文本提示",
          value: "",
          onChange: noop,
        }),
        createElement(ListField, {
          label: "名单",
          hint: "名单提示",
          value: [],
          onChange: noop,
        }),
      ),
    );
    const controls = [
      view.container.querySelector<HTMLInputElement>('input[id]:not([type="hidden"])')!,
      view.container.querySelector<HTMLInputElement>("input + input"),
    ];
    const inputs = [...view.container.querySelectorAll<HTMLInputElement>("input")];
    for (const input of inputs) {
      assert.ok(input.id !== "");
      assert.equal(input.getAttribute("aria-describedby"), `${input.id}-hint`);
    }
    assert.equal(controls.length, 2);
    await view.unmount();
  });

  it("SelectField 重新打开时优先激活当前选中项", async () => {
    const seen: string[] = [];
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "b",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙" },
          { value: "c", label: "丙" },
        ],
        onChange: (value: string): void => {
          seen.push(value);
        },
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    const active = view.container.querySelector<HTMLElement>('[data-active="true"]')!;
    assert.equal(active.textContent, "乙");
    await fire(trigger, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(seen, ["b"]);
    await view.unmount();
  });

  it.each([
    ["End", "丙"],
    ["Home", "甲"],
  ] as const)("SelectField 关闭态 %s 打开并落到末项/首项", async (key, expected) => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "b",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙" },
          { value: "c", label: "丙" },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await fire(trigger, new KeyboardEvent("keydown", { key, bubbles: true }));
    const active = view.container.querySelector<HTMLElement>('[data-active="true"]')!;
    assert.equal(active.textContent, expected, key);
    await view.unmount();
  });

  it("SelectField Tab 关闭、焦点移出组件关闭", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    const wrap = view.container.querySelector<HTMLElement>(".dsu-selectWrap")!;
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await click(trigger);
    await fire(wrap, new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await click(trigger);
    await fire(wrap, new FocusEvent("focusout", { bubbles: true, relatedTarget: menu }));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await view.unmount();
  });

  it("SelectField 浮层内部滚动不关闭，listbox 带字段名", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    await click(trigger);
    assert.equal(menu.getAttribute("aria-label"), "形态");
    await fire(menu, new Event("scroll", { bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await view.unmount();
  });

  it("SelectField 活动项滚进菜单可视区", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲" },
          { value: "b", label: "乙" },
          { value: "c", label: "丙" },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    const nodes = [...menu.querySelectorAll<HTMLElement>(".dsu-option")];
    Object.defineProperty(nodes[2]!, "offsetTop", { value: 300 });
    Object.defineProperty(nodes[2]!, "offsetHeight", { value: 34 });
    Object.defineProperty(menu, "clientHeight", { value: 280 });
    await click(trigger);
    await fire(trigger, new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    assert.equal(menu.scrollTop, 54);
    menu.scrollTop = 120;
    await fire(trigger, new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(menu.scrollTop, 0);
    await view.unmount();
  });

  it("SelectField 相同分组分段出现两次也有不同 key", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [
          { value: "a", label: "甲", group: "G" },
          { value: "b", label: "乙" },
          { value: "c", label: "丙", group: "G" },
        ],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await click(trigger);
    const headings = [...view.container.querySelectorAll<HTMLElement>(".dsu-optionGroup")];
    assert.equal(headings.length, 2);
    await view.unmount();
  });

  it("数字草稿不被父组件回写打断，失焦才规范化", async () => {
    const view = await mount(createElement(ControlledNumber));
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input, "1.");
    assert.equal(input.value, "1.");
    await typeInto(input, "1.5");
    assert.equal(input.value, "1.5");
    await fire(input, new FocusEvent("focusout", { bubbles: true }));
    assert.equal(input.value, "1.5");
    await typeInto(input, "01");
    assert.equal(input.value, "01");
    await fire(input, new FocusEvent("focusout", { bubbles: true }));
    assert.equal(input.value, "1");
    await view.unmount();
  });

  it("step 参与校验：不合步长视为无效", async () => {
    const seen: (number | undefined)[] = [];
    const view = await mount(
      createElement(NumberField, {
        label: "数字",
        value: 1,
        min: 1,
        max: 10,
        step: 0.5,
        invalidHint: "越界",
        onChange: (next: number | undefined): void => {
          seen.push(next);
        },
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input, "1.2");
    assert.deepEqual(seen, []);
    assert.equal(input.getAttribute("aria-invalid"), "true");
    await typeInto(input, "1.5");
    assert.deepEqual(seen, [1.5]);
    assert.equal(input.getAttribute("aria-invalid"), null);
    await view.unmount();
  });

  it("step 无 min 时以 0 为基准，step<=0 不约束", async () => {
    const seen: (number | undefined)[] = [];
    const view = await mount(
      createElement(NumberField, {
        label: "数字",
        value: 0,
        step: 0.5,
        invalidHint: "越界",
        onChange: (next: number | undefined): void => {
          seen.push(next);
        },
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input, "0.5");
    assert.deepEqual(seen, [0.5]);
    await view.unmount();
    const seen2: (number | undefined)[] = [];
    const view2 = await mount(
      createElement(NumberField, {
        label: "数字",
        value: 0,
        step: 0,
        invalidHint: "越界",
        onChange: (next: number | undefined): void => {
          seen2.push(next);
        },
      }),
    );
    const input2 = view2.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input2, "1.5");
    assert.deepEqual(seen2, [1.5]);
    await view2.unmount();
  });

  it("数字失焦不改动空值与越界草稿", async () => {
    const view = await mount(
      createElement(NumberField, {
        label: "数字",
        value: 1,
        min: 1,
        max: 10,
        invalidHint: "越界",
        onChange: noop,
      }),
    );
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    await typeInto(input, "");
    await fire(input, new FocusEvent("focusout", { bubbles: true }));
    assert.equal(input.value, "");
    await typeInto(input, "99");
    await fire(input, new FocusEvent("focusout", { bubbles: true }));
    assert.equal(input.value, "99");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    await view.unmount();
  });

  it("组件禁用时键盘路径也无法打开", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        disabled: true,
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    await fire(trigger, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await view.unmount();
  });

  it("选项上按下鼠标不转移焦点", async () => {
    const view = await mount(
      createElement(SelectField, {
        label: "形态",
        value: "a",
        options: [{ value: "a", label: "甲" }],
        onChange: noop,
      }),
    );
    const trigger = view.container.querySelector<HTMLButtonElement>(".dsu-select")!;
    const menu = view.container.querySelector<HTMLElement>(".dsu-menu")!;
    const option = menu.querySelector<HTMLButtonElement>(".dsu-option")!;
    trigger.focus();
    await fire(option, new MouseEvent("mousedown", { bubbles: true }));
    assert.equal(document.activeElement, trigger);
    await view.unmount();
  });

  it("样式表限制浮层尺寸并允许内部滚动", () => {
    assert.ok(CARD_UI_CSS.includes("max-height:calc(100vh - 16px)"));
    assert.ok(CARD_UI_CSS.includes("max-width:min(340px,calc(100vw - 16px))"));
    assert.ok(CARD_UI_CSS.includes("overflow-wrap:anywhere"));
  });
});
