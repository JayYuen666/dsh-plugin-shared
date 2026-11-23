// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import {
  Badge,
  Callout,
  DataTable,
  EmptyState,
  Field,
  FieldTwoCol,
  KpiGrid,
  KpiTile,
  LogPanel,
  Meter,
  Section,
  Segmented,
  StatusDot,
  ToolRow,
  ToolRowGrid,
  ToolRowItem,
} from "../lib/card-ui.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { click, fire, mount, noop, textOf } from "./card-ui-helpers.ts";

/** 首字母大写（色调 → 类名拼接用）。charAt 在 noUncheckedIndexedAccess 下不产生 undefined。 */
const cap = (tone: string): string => tone.charAt(0).toUpperCase() + tone.slice(1);

/** 纯展示组件的静态渲染：无 hooks 无交互的用例不需要挂载，也就不需要并发 act。 */
function markup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

const BADGE_TONES = ["neutral", "business", "ok", "warn", "err"] as const;
const DOT_TONES = ["ok", "warn", "err", "mute"] as const;
const CALLOUT_TONES = ["info", "ok", "warn", "err"] as const;
const METER_TONES = ["business", "ok", "warn"] as const;

const TBL_NUM_CLS = "dsu-tblNum";
const TOOLROW_VAL_SEL = ".dsu-toolrowVal";

describe("badge 与状态点", () => {
  it("badge 五种色调各渲染对应类名", () => {
    for (const tone of BADGE_TONES) {
      assert.ok(
        markup(createElement(Badge, { tone }, "x")).includes(
          `class="dsu-badge dsu-badge${cap(tone)}"`,
        ),
      );
    }
  });

  it("badge 缺省色调是 neutral，无子节点也渲染", () => {
    const html = markup(createElement(Badge, null));
    assert.ok(html.includes('class="dsu-badge dsu-badgeNeutral"'));
    assert.equal(html, '<span class="dsu-badge dsu-badgeNeutral"></span>');
  });

  it("badge 可带状态点与 data-field，点的色调独立于底色", () => {
    const html = markup(
      createElement(Badge, { tone: "warn", dot: "warn", field: "cli-badge" }, "版本偏离"),
    );
    assert.ok(html.includes('data-field="cli-badge"'));
    assert.ok(html.includes('class="dsu-dot dsu-dotWarn"'));
    assert.ok(html.endsWith("版本偏离</span>"));
  });

  it("状态点四种色调各渲染对应类名", () => {
    for (const tone of DOT_TONES) {
      assert.ok(
        markup(createElement(StatusDot, { tone })).includes(`class="dsu-dot dsu-dot${cap(tone)}"`),
      );
    }
  });

  it("状态点缺省色调是 mute", () => {
    assert.ok(markup(createElement(StatusDot, null)).includes('class="dsu-dot dsu-dotMute"'));
  });

  it("状态点带 label 时是可读的状态而不是装饰", () => {
    const html = markup(createElement(StatusDot, { tone: "warn", label: "非规范档位形状" }));
    assert.ok(html.includes('role="img"'));
    assert.ok(html.includes('aria-label="非规范档位形状"'));
    assert.ok(html.includes('title="非规范档位形状"'));
    assert.ok(!html.includes("aria-hidden"));
  });
});

describe("callout", () => {
  it("四种色调各渲染对应类名与图形符号", () => {
    for (const tone of CALLOUT_TONES) {
      const html = markup(createElement(Callout, { tone }, "正文"));
      assert.ok(
        html.includes(`class="dsu-callout dsu-callout${cap(tone)}"`),
        `色调 ${tone} 缺类名`,
      );
      assert.ok(html.includes("dsu-calloutIcon"), `色调 ${tone} 缺图标槽`);
      assert.ok(html.includes("<svg"), `色调 ${tone} 缺图形`);
    }
  });

  it("缺省色调是 info，图标槽不带文字", () => {
    const html = markup(createElement(Callout, null, "正文"));
    assert.ok(html.includes('class="dsu-callout dsu-calloutInfo"'));
    assert.ok(html.includes('class="dsu-calloutIcon"'));
    assert.ok(html.endsWith("正文</div>"));
  });
});

describe("kpi 瓦片", () => {
  it("栅格容器渲染子节点", () => {
    const html = markup(createElement(KpiGrid, null, createElement("span", null, "格")));
    assert.ok(html.includes('class="dsu-kpiGrid"'));
    assert.ok(html.includes(">格</span>"));
  });

  it("只带必填项时可选位都不渲染", () => {
    const html = markup(createElement(KpiTile, { label: "改写次数", value: "128" }));
    assert.ok(html.includes(">改写次数</div>"));
    assert.ok(html.includes(">128</div>"));
    for (const absent of ["dsu-kpiUnit", "dsu-kpiSub", "dsu-kpiDelta"]) {
      assert.ok(!html.includes(absent), `${absent} 不该出现`);
    }
  });

  it("可选位齐全时逐个渲染", () => {
    const html = markup(
      createElement(KpiTile, {
        label: "节省 token",
        value: "46.2",
        unit: "k",
        sub: "窗口内 14 天",
        delta: { direction: "up", text: "↑ 8.4%" },
      }),
    );
    assert.ok(html.includes('>46.2<span class="dsu-kpiUnit">k</span></div>'));
    assert.ok(html.includes('>窗口内 14 天</div><span class="dsu-kpiDelta dsu-kpiDeltaUp">↑ 8.4%'));
  });

  it("下跌增量用下行色", () => {
    const html = markup(
      createElement(KpiTile, {
        label: "改写",
        value: 24,
        delta: { direction: "down", text: "−6" },
      }),
    );
    assert.ok(html.includes('class="dsu-kpiDelta dsu-kpiDeltaDown"'));
  });

  it("count 让数值格带 data-count 与动画目标变量", () => {
    const html = markup(createElement(KpiTile, { label: "改写", value: "128", count: 128 }));
    assert.ok(html.includes('data-count="128"'));
    assert.ok(html.includes("--dsu-count-target:128"));
  });

  it("不给 count 时不渲染动画锚点", () => {
    const html = markup(createElement(KpiTile, { label: "节省", value: "46.2k" }));
    assert.ok(!html.includes("data-count"));
  });
});

describe("dataTable", () => {
  const columns = [
    { key: "name", label: "命令族", strong: true, mono: true },
    { key: "count", label: "次数", numeric: true },
    { key: "ratio", label: "节省率", numeric: true },
  ];
  const rows = [
    { key: "r1", cells: ["git commit", 412, "62%"] },
    { key: "r2", cells: ["pnpm test", 208] },
  ];

  it("渲染表头与数据行，列修饰各自落类", () => {
    const html = markup(createElement(DataTable, { columns, rows }));
    assert.ok(html.includes('<th scope="col" class="">命令族</th>'));
    assert.ok(html.includes(`<th scope="col" class="${TBL_NUM_CLS}">次数</th>`));
    assert.ok(html.includes('<td class="dsu-tblMono dsu-tblId">git commit</td>'));
    assert.ok(html.includes(`<td class="${TBL_NUM_CLS}">412</td>`));
  });

  it("行数据缺列时该格补空不抛错", () => {
    const html = markup(createElement(DataTable, { columns, rows }));
    assert.ok(
      html.includes(
        '<tr><td class="dsu-tblMono dsu-tblId">pnpm test</td><td class="dsu-tblNum">208</td><td class="dsu-tblNum"></td></tr>',
      ),
    );
  });

  it("foot 与 scroll 可选位生效", () => {
    const html = markup(
      createElement(DataTable, { columns, rows, foot: "窗口 14 天", scroll: true }),
    );
    assert.ok(html.includes('class="dsu-tblWrap dsu-tblScroll"'));
    assert.ok(html.includes('<div class="dsu-tblFoot">窗口 14 天</div>'));
  });

  it("caption 只做读屏表名，视觉由 srOnly 隐藏", () => {
    const html = markup(createElement(DataTable, { columns, rows, caption: "跳过原因构成完整表" }));
    assert.ok(html.includes('<caption class="dsu-srOnly">跳过原因构成完整表</caption>'));
    const plain = markup(createElement(DataTable, { columns, rows }));
    assert.ok(!plain.includes("<caption"));
  });

  it("ellipsis 列的字符串格带单行省略、aria-label 全文，悬停弹出全文浮层", async () => {
    const TIP_CLS = ".dsu-tblTip";
    const LONG_PATH = "/Users/you/projects/很长的路径/xxx";
    const ellipsisColumns = [{ key: "path", label: "目录", strong: true, ellipsis: true }];
    const ellipsisRows = [{ key: "r1", cells: [LONG_PATH] }];
    const html = markup(
      createElement(DataTable, { columns: ellipsisColumns, rows: ellipsisRows, stickyFirst: true }),
    );
    assert.ok(html.includes('class="dsu-tblEllip"'));
    assert.ok(html.includes(`aria-label="${LONG_PATH}"`));
    assert.ok(!html.includes("dsu-tblTip"), "未悬停时不画浮层");
    const plain = markup(createElement(DataTable, { columns, rows }));
    assert.ok(!plain.includes("dsu-tblEllip"));

    // 悬停浮层：原生 title 在宿主 webview 不渲染，全文由自绘浮层承担（portal 到 body——
    // 冻结列是 sticky 定位元素，格内 fixed 会被它劫持成包含块）。
    // 定位分支按真实布局量：把格子按到视口右缘与底缘，三条收口路径各走一遍。
    const view = await mount(
      createElement(DataTable, { columns: ellipsisColumns, rows: ellipsisRows }),
    );
    const cell = view.container.querySelector<HTMLElement>(".dsu-tblEllip")!;
    const realWidth = globalThis.innerWidth;
    const realHeight = globalThis.innerHeight;
    try {
      // 常规位：浮层在格下方，左缘即格子左缘。
      cell.getBoundingClientRect = () =>
        ({ left: 40, right: 300, top: 100, bottom: 130, width: 260, height: 30 }) as DOMRect;
      await fire(cell, new MouseEvent("mouseover", { bubbles: true }));
      const tip = document.body.querySelector<HTMLElement>(TIP_CLS);
      assert.ok(tip !== null, "悬停后出现全文浮层");
      assert.equal(tip.textContent, LONG_PATH);
      assert.ok(tip.style.left === "40px" && tip.style.top === "136px");
      await fire(cell, new MouseEvent("mouseout", { bubbles: true }));
      assert.equal(document.body.querySelector(".dsu-tblTip"), null, "移开后浮层收起");

      // 贴右缘：左缘回收到视口内。
      Object.defineProperty(globalThis, "innerWidth", { value: 420, configurable: true });
      cell.getBoundingClientRect = () =>
        ({ left: 300, right: 400, top: 100, bottom: 130, width: 100, height: 30 }) as DOMRect;
      await fire(cell, new MouseEvent("mouseover", { bubbles: true }));
      assert.equal(
        document.body.querySelector<HTMLElement>(TIP_CLS)?.style.left,
        "52px",
        "贴右缘时左缘回收（420-360-8）",
      );

      // 贴底缘：浮层翻到格子上方（translateY(-100%)）。
      Object.defineProperty(globalThis, "innerHeight", { value: 180, configurable: true });
      await fire(cell, new MouseEvent("mouseover", { bubbles: true }));
      const flipped = document.body.querySelector<HTMLElement>(TIP_CLS);
      assert.ok(flipped !== null);
      assert.equal(flipped.style.top, "94px", "贴底缘时锚在格子上沿");
      assert.equal(flipped.style.transform, "translateY(-100%)");

      // 贴左缘：回收后的左缘为负时再钉到 8px。
      Object.defineProperty(globalThis, "innerWidth", { value: 120, configurable: true });
      cell.getBoundingClientRect = () =>
        ({ left: 2, right: 60, top: 100, bottom: 130, width: 58, height: 30 }) as DOMRect;
      await fire(cell, new MouseEvent("mouseover", { bubbles: true }));
      assert.equal(
        document.body.querySelector<HTMLElement>(TIP_CLS)?.style.left,
        "8px",
        "左缘越出视口时钉在 8px",
      );
    } finally {
      Object.defineProperty(globalThis, "innerWidth", { value: realWidth, configurable: true });
      Object.defineProperty(globalThis, "innerHeight", { value: realHeight, configurable: true });
      delete (cell as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      await view.unmount();
    }
  });

  it("stickyFirst 冻结首列", () => {
    const html = markup(createElement(DataTable, { columns, rows, stickyFirst: true }));
    assert.ok(html.includes('class="dsu-tbl dsu-tblSticky"'));
    const plain = markup(createElement(DataTable, { columns, rows }));
    assert.ok(plain.includes('class="dsu-tbl"'));
    assert.ok(!plain.includes("dsu-tblSticky"));
  });

  it("无 foot 无 scroll 时两者都不出现", () => {
    const html = markup(createElement(DataTable, { columns, rows }));
    assert.ok(html.includes('<div class="dsu-tblWrap">'));
    assert.ok(!html.includes("dsu-tblScroll"));
    assert.ok(!html.includes("dsu-tblFoot"));
  });

  it("空行带 empty 节点时只渲染空态", () => {
    const html = markup(
      createElement(DataTable, {
        columns,
        rows: [],
        empty: createElement("div", { className: "dsu-empty" }, "没有数据"),
      }),
    );
    assert.ok(!html.includes("<table"));
    assert.ok(html.includes(">没有数据</div></div>"));
  });

  it("空行无 empty 节点时整块不渲染", () => {
    assert.equal(markup(createElement(DataTable, { columns, rows: [] })), "");
  });
});

describe("meter 量条", () => {
  it("缺省标签按百分比显示", () => {
    const html = markup(createElement(Meter, { ratio: 0.256 }));
    assert.ok(html.includes('class="dsu-meterFill" style="width:26%"'));
    assert.ok(html.includes('<span class="dsu-meterNum">26%</span>'));
  });

  it("自定义标签与三种色调", () => {
    for (const tone of METER_TONES) {
      const html = markup(createElement(Meter, { ratio: 0.5, label: "62%", tone }));
      const fillCls =
        tone === "business" ? "dsu-meterFill" : `dsu-meterFill dsu-meterFill${cap(tone)}`;
      assert.ok(html.includes(`class="${fillCls}" style="width:50%"`), `色调 ${tone} 缺类名`);
      assert.ok(html.includes(">62%</span>"));
    }
  });

  it("非法与越界比例一律钳回 0–1", () => {
    assert.ok(markup(createElement(Meter, { ratio: Number.NaN })).includes("width:0%"));
    assert.ok(markup(createElement(Meter, { ratio: -0.4 })).includes("width:0%"));
    assert.ok(markup(createElement(Meter, { ratio: 1.7 })).includes("width:100%"));
  });
});

describe("日志面板", () => {
  const ACTION = ".dsu-logAction";
  const ACTIONS = ".dsu-logActions";
  const OCR_VERSION = "ocr version";

  it("头部带状态点、说明与动作，动作可点击", async () => {
    const onCopy = vi.fn<() => void>();
    const view = await mount(
      createElement(
        LogPanel,
        { label: "重建作业 #a3f2", tone: "ok", actions: [{ label: "复制", onClick: onCopy }] },
        "第 1 行",
      ),
    );
    assert.ok(view.container.querySelector(".dsu-dotOk"));
    assert.equal(textOf(view.container, ".dsu-logHead"), "重建作业 #a3f2复制");
    await click(view.container.querySelector(ACTION)!);
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(expect.anything());
    assert.equal(textOf(view.container, ".dsu-logBody"), "第 1 行");
    await view.unmount();
  });

  it("命令型输出在头部给复制动作，复制成功后换成已复制", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      const command = "dsh-scrapling setup --feature browser --apply";
      const view = await mount(
        createElement(
          LogPanel,
          {
            label: "安装命令",
            copyText: command,
            copyLabel: "复制",
            copiedLabel: "已复制",
          },
          command,
        ),
      );
      assert.equal(textOf(view.container, ACTIONS), "复制");
      await click(view.container.querySelector(ACTION)!);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(command);
      assert.equal(textOf(view.container, ACTIONS), "已复制");
      await view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("没有剪贴板时复制动作不谎报成功", async () => {
    vi.stubGlobal("navigator", {});
    try {
      const command = OCR_VERSION;
      const view = await mount(
        createElement(
          LogPanel,
          { label: "命令", copyText: command, copyLabel: "复制", copiedLabel: "已复制" },
          command,
        ),
      );
      await click(view.container.querySelector(ACTION)!);
      assert.equal(textOf(view.container, ACTIONS), "复制");
      await view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("剪贴板拒绝时保持复制标签", async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      const command = OCR_VERSION;
      const view = await mount(
        createElement(
          LogPanel,
          { label: "命令", copyText: command, copyLabel: "复制", copiedLabel: "已复制" },
          command,
        ),
      );
      await click(view.container.querySelector(ACTION)!);
      await Promise.resolve();
      assert.equal(textOf(view.container, ACTIONS), "复制");
      await view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("没有 copiedLabel 时沿用 copyLabel，不凭空造词", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      const command = OCR_VERSION;
      const view = await mount(
        createElement(LogPanel, { label: "命令", copyText: command, copyLabel: "COPY" }, command),
      );
      await click(view.container.querySelector(ACTION)!);
      assert.equal(textOf(view.container, ACTIONS), "COPY");
      await view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("无动作时动作区不渲染", () => {
    const html = markup(createElement(LogPanel, { label: "输出" }, "正文"));
    assert.ok(html.includes('class="dsu-logHead"'));
    assert.ok(!html.includes("dsu-logActions"));
  });

  it("semanticLines 只给可识别的状态行上色，不动正文", () => {
    const html = markup(
      createElement(
        LogPanel,
        { label: "作业", semanticLines: true },
        "roots: 3 个工作区已登记\n[12:04:16] 跳过 node_modules\nERROR: zg exited\n普通一行",
      ),
    );
    assert.ok(html.includes('class="dsu-logOk"'));
    assert.ok(html.includes('class="dsu-logWarn"'));
    assert.ok(html.includes('class="dsu-logErr"'));
    assert.ok(!html.includes('class="dsu-logOk">普通一行'));
    assert.ok(html.includes("普通一行"));
  });

  it("semanticLines 不把路径里的 error 当成失败", () => {
    const html = markup(
      createElement(
        LogPanel,
        { label: "路径", semanticLines: true },
        "/tmp/error.log\n/var/log/warnings",
      ),
    );
    assert.ok(!html.includes("dsu-logErr"));
    assert.ok(!html.includes("dsu-logWarn"));
  });

  it("semanticLines 关闭时不把命令原文按关键词染色", () => {
    const html = markup(createElement(LogPanel, { label: "命令" }, "echo error > error.log"));
    assert.ok(!html.includes("dsu-logErr"));
  });

  it("头部三项全缺省时不渲染头部", () => {
    const html = markup(createElement(LogPanel, null, "只有正文"));
    assert.ok(!html.includes("dsu-logHead"));
    assert.ok(html.includes('<pre class="dsu-logBody">只有正文</pre>'));
  });
});

describe("分段页签", () => {
  const options = [
    { value: "prefix", label: "命令改写" },
    { value: "pipe", label: "结果压缩" },
  ];

  it("渲染选项并标出选中项", () => {
    const html = markup(
      createElement(Segmented, { options, value: "pipe", onChange: noop, ariaLabel: "形态" }),
    );
    assert.ok(html.includes('aria-label="形态"'));
    assert.ok(html.includes('aria-selected="false" data-value="prefix"'));
    assert.ok(html.includes('aria-selected="true" data-value="pipe"'));
    assert.ok(html.includes(">命令改写</button>"));
    assert.ok(html.includes(">结果压缩</button>"));
  });

  it("点击选项回调对应值", async () => {
    const onChange = vi.fn<(next: string) => void>();
    const view = await mount(createElement(Segmented, { options, value: "prefix", onChange }));
    await click(view.container.querySelector("[data-value='pipe']")!);
    expect(onChange).toHaveBeenCalledWith("pipe");
    await view.unmount();
  });
});

describe("空态", () => {
  const EMPTY_ICON = 'class="dsu-emptyIcon"';
  const EMPTY_TITLE = '<span class="dsu-emptyTitle">窗口内没有数据</span>';

  it("图标、标题与正文都渲染", () => {
    const html = markup(createElement(EmptyState, { title: "窗口内没有数据" }, "调整范围后重试"));
    assert.ok(html.includes(EMPTY_ICON));
    assert.ok(html.includes(EMPTY_TITLE));
    assert.ok(html.includes('<span class="dsu-emptyBody">调整范围后重试</span>'));
  });

  it("只有正文时仍带空托盘图标，不渲染标题位", () => {
    const html = markup(createElement(EmptyState, null, "暂无数据"));
    assert.ok(html.includes(EMPTY_ICON));
    assert.ok(!html.includes("dsu-emptyTitle"));
    assert.ok(html.includes('<span class="dsu-emptyBody">暂无数据</span>'));
  });

  it("只有标题时不渲染正文位", () => {
    const html = markup(createElement(EmptyState, { title: "窗口内没有数据" }));
    assert.ok(html.includes(EMPTY_ICON));
    assert.ok(html.includes(EMPTY_TITLE));
    assert.ok(!html.includes("dsu-emptyBody"));
  });

  it("plain 只去掉底色，图标与文案照旧", () => {
    const html = markup(createElement(EmptyState, { title: "窗口内没有数据", plain: true }));
    assert.ok(html.includes('class="dsu-empty dsu-emptyPlain"'));
    assert.ok(html.includes(EMPTY_ICON));
    assert.ok(html.includes(EMPTY_TITLE));
  });
});

describe("工具行", () => {
  it("头部状态点、名称、徽章、相位与脚部动作齐全", async () => {
    const urlItem = createElement(ToolRowItem, { label: "URL", value: "https://example.com" });
    const noteItem = createElement(ToolRowItem, { label: "说明", value: "要求登录", tone: "warn" });
    const grid = createElement(ToolRowGrid, null, urlItem, noteItem);
    const badge = createElement(Badge, { tone: "warn" }, "403");
    const foot = createElement("button", { type: "button" }, "查看轨迹");
    const row = createElement(
      ToolRow,
      { name: "scrape_get", tone: "warn", phase: "result", badge, foot },
      grid,
    );
    const view = await mount(row);
    assert.ok(view.container.querySelector(".dsu-dotWarn"));
    assert.equal(textOf(view.container, ".dsu-toolrowName"), "scrape_get");
    assert.equal(textOf(view.container, ".dsu-toolrowPhase"), "result");
    assert.equal(view.container.querySelectorAll(".dsu-badge").length, 1);
    assert.equal(view.container.querySelectorAll(".dsu-toolrowKey").length, 2);
    assert.ok(
      view.container.querySelectorAll(TOOLROW_VAL_SEL)[1]!.classList.contains("dsu-toolrowValWarn"),
    );
    assert.equal(textOf(view.container, ".dsu-toolrowFoot"), "查看轨迹");
    await view.unmount();
  });

  it("缺省色调的状态点与键值都走中性色", async () => {
    const hitItem = createElement(ToolRowItem, { label: "命中数", value: 3 });
    const errItem = createElement(ToolRowItem, { label: "错误", value: "超时", tone: "err" });
    const grid = createElement(ToolRowGrid, null, hitItem, errItem);
    const row = createElement(ToolRow, { name: "curl_html" }, grid);
    const view = await mount(row);
    assert.equal(view.container.querySelector(".dsu-dot")?.className, "dsu-dot dsu-dotMute");
    assert.equal(view.container.querySelector(".dsu-toolrowPhase"), null);
    assert.equal(view.container.querySelector(".dsu-toolrowFoot"), null);
    assert.equal(view.container.querySelector(".dsu-toolrowVal")?.className, "dsu-toolrowVal");
    assert.ok(
      view.container.querySelectorAll(TOOLROW_VAL_SEL)[1]!.classList.contains("dsu-toolrowValErr"),
    );
    await view.unmount();
  });
});

describe("双列字段栅格", () => {
  it("渲染栅格容器与子字段", () => {
    const html = markup(
      createElement(FieldTwoCol, null, createElement(Field, { label: "续跑延迟" }, null)),
    );
    assert.ok(html.includes('class="dsu-fieldCols"'));
    assert.ok(html.includes('class="dsu-field"'));
  });
});

describe("section 计数与动作位", () => {
  it("count 渲染业务色徽章，actions 渲染右侧动作位", () => {
    const refresh = createElement("button", { type: "button" }, "刷新");
    const html = markup(
      createElement(
        Section,
        { title: "429 重试策略", count: "4 Provider", actions: refresh },
        createElement("div", { className: "dsu-sectionChild" }, "字段"),
      ),
    );
    assert.ok(html.includes('<h2 class="dsu-sectionTitle">429 重试策略</h2>'));
    assert.ok(html.includes('class="dsu-badge dsu-badgeBusiness">4 Provider'));
    assert.ok(html.includes('class="dsu-sectionActions"><button type="button">刷新</button>'));
  });

  it("缺省不渲染计数与动作位", () => {
    const html = markup(createElement(Section, { title: "门禁" }));
    assert.ok(html.includes('<h2 class="dsu-sectionTitle">门禁</h2>'));
    assert.ok(!html.includes("dsu-badge"));
    assert.ok(!html.includes("dsu-sectionActions"));
  });
});

describe("savebar 面板顺序", () => {
  it("状态在最前，撤销在保存之前", async () => {
    const { SaveBar } = await import("../lib/card-ui.ts");
    const view = await mount(
      createElement(SaveBar, {
        dirty: true,
        busy: false,
        writable: true,
        error: null,
        saveLabel: "保存",
        savingLabel: "保存中",
        revertLabel: "撤销",
        dirtyLabel: "已修改",
        cleanLabel: "一致",
        readOnlyLabel: "只读",
        onSave: noop,
        onDiscard: noop,
      }),
    );
    const order = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-field], .dsu-status, .dsu-dirtyPill"),
      (node) => node.dataset["field"] ?? "status",
    );
    assert.deepEqual(order, ["status", "discard", "save"]);
    const info = view.container.querySelector<HTMLElement>(".dsu-saveInfo");
    assert.ok(info);
    assert.equal(info.textContent, "已修改");
    assert.equal(info.querySelector("button"), null);
    assert.equal(view.container.querySelector(".dsu-savebar")!.firstElementChild, info);
    await view.unmount();
  });
});
