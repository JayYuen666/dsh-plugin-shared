// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_UI_CSS } from "../lib/card-ui/styles.ts";
import {
  CARD_UI_CSS_VERSION,
  CARD_UI_OVERRIDE_STYLE_ID,
  CARD_UI_REFS_KEY,
  CARD_UI_STYLE_ID,
  CARD_UI_VERSION_KEY,
  ensureCardUiCss,
} from "../lib/card-ui/style-tag.ts";

interface FakeTag {
  id: string;
  textContent: string;
  remove: () => void;
}

interface FakeDocument {
  querySelector: (selector: string) => unknown;
  createElement: (tag: string) => FakeTag;
  head: { append: (node: FakeTag) => void };
}

interface FakeState {
  appended: FakeTag[];
  removed: FakeTag[];
  doc: FakeDocument;
}

function fakeDocument(existing: unknown = null, overrideExisting: unknown = null): FakeState {
  const appended: FakeTag[] = [];
  const removed: FakeTag[] = [];
  const doc: FakeDocument = {
    querySelector: (selector: string): unknown => {
      if (selector === `#${CARD_UI_STYLE_ID}` && existing !== null) {
        return existing;
      }
      if (selector === `#${CARD_UI_OVERRIDE_STYLE_ID}` && overrideExisting !== null) {
        return overrideExisting;
      }
      return appended.find((tag) => `#${tag.id}` === selector) ?? null;
    },
    createElement: (): FakeTag => {
      const tag: FakeTag = {
        id: "",
        textContent: "",
        remove: () => {
          removed.push(tag);
        },
      };
      return tag;
    },
    head: {
      append: (node: FakeTag): void => {
        appended.push(node);
      },
    },
  };
  return { appended, removed, doc };
}

function ruleBody(selector: string): string {
  const marker = `${selector}{`;
  const start = CARD_UI_CSS.indexOf(marker);
  if (start === -1) {
    return "";
  }
  const bodyStart = start + marker.length;
  const end = CARD_UI_CSS.indexOf("}", bodyStart);
  return end === -1 ? "" : CARD_UI_CSS.slice(bodyStart, end);
}

function rejectCreate(): FakeTag {
  return {
    id: "",
    textContent: "",
    remove: () => {
      throw new Error("不应创建");
    },
  };
}

describe("card-ui style tag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelector(`#${CARD_UI_STYLE_ID}`)?.remove();
    document.querySelector(`#${CARD_UI_OVERRIDE_STYLE_ID}`)?.remove();
  });

  describe("ensureCardUiCss", () => {
    it("首次注入一个固定 id 的 style，正文是 CARD_UI_CSS", () => {
      const { appended, doc } = fakeDocument();
      const dispose = ensureCardUiCss(doc);
      const [tag] = appended;
      expect(appended).toHaveLength(1);
      expect(tag?.id).toBe(CARD_UI_STYLE_ID);
      expect(tag?.textContent).toBe(CARD_UI_CSS);
      dispose();
    });

    it("重复调用只保留一个 style，最后一个引用释放后才移除", () => {
      const { appended, removed, doc } = fakeDocument();
      const first = ensureCardUiCss(doc);
      const second = ensureCardUiCss(doc);
      expect(appended).toHaveLength(1);
      const [tag] = appended;
      first();
      expect(removed).toStrictEqual([]);
      second();
      expect(removed).toStrictEqual([tag]);
    });

    it("同一个释放函数调用两次不会多减引用", () => {
      const { appended, removed, doc } = fakeDocument();
      const first = ensureCardUiCss(doc);
      const second = ensureCardUiCss(doc);
      const [tag] = appended;
      first();
      first();
      expect(removed).toStrictEqual([]);
      second();
      expect(removed).toStrictEqual([tag]);
    });

    it("已有内容不同的同 id style 时追加覆盖样式，且不摘旧 style", () => {
      const foreign: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "already",
        remove: () => {
          throw new Error("不应移除别人的 style");
        },
      };
      const { appended, doc } = fakeDocument(foreign);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(1);
      expect(appended[0]?.id).toBe(CARD_UI_OVERRIDE_STYLE_ID);
      expect(appended[0]?.textContent).toBe(CARD_UI_CSS);
      expect(() => {
        dispose();
      }).not.toThrow();
    });

    it("同 id 的元素不是可移除对象时按外部样式处理", () => {
      const { appended, doc } = fakeDocument("not-an-element");
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
      expect(() => {
        dispose();
      }).not.toThrow();
    });

    it("引用计数不是正整数时不认领旧 style，但仍补当前样式", () => {
      const marked: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "",
        remove: () => {
          throw new Error("不应移除未认领的 style");
        },
      };
      Reflect.set(marked, CARD_UI_REFS_KEY, 0);
      const { appended, doc } = fakeDocument(marked);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(1);
      expect(appended[0]?.id).toBe(CARD_UI_OVERRIDE_STYLE_ID);
      expect(() => {
        dispose();
      }).not.toThrow();
    });

    it("旧一代同 id 样式已标记引用时仍补覆盖样式", () => {
      const old: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: ".dsu-savebar{background:var(--dsw-alias-bg-base)}",
        remove: () => {
          throw new Error("不应移除旧 style");
        },
      };
      Reflect.set(old, CARD_UI_REFS_KEY, 1);
      const { appended, removed, doc } = fakeDocument(old);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(1);
      expect(appended[0]?.id).toBe(CARD_UI_OVERRIDE_STYLE_ID);
      expect(appended[0]?.textContent).toBe(CARD_UI_CSS);
      expect(removed).toStrictEqual([]);
      dispose();
      expect(removed).toStrictEqual([appended[0]]);
    });

    it("已有当前版本但没有引用计数的同 id style 时不认领", () => {
      const current: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: CARD_UI_CSS,
        remove: () => {
          throw new Error("不应移除未认领的 style");
        },
      };
      Reflect.set(current, CARD_UI_VERSION_KEY, CARD_UI_CSS_VERSION);
      const { appended, doc } = fakeDocument(current);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
      expect(() => {
        dispose();
      }).not.toThrow();
    });

    it("覆盖 id 的元素不是可移除对象时按外部样式处理", () => {
      const old: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "old",
        remove: () => void 0,
      };
      Reflect.set(old, CARD_UI_REFS_KEY, 1);
      const { appended, doc } = fakeDocument(old, "not-an-override");
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
      expect(() => {
        dispose();
      }).not.toThrow();
    });

    it("已有未认领的旧覆盖样式时认领并升级到当前正文", () => {
      const old: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "old",
        remove: () => void 0,
      };
      Reflect.set(old, CARD_UI_REFS_KEY, 1);
      let removed = 0;
      const override: FakeTag = {
        id: CARD_UI_OVERRIDE_STYLE_ID,
        textContent: "older-override",
        remove: () => {
          removed += 1;
        },
      };
      const { appended, doc } = fakeDocument(old, override);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
      expect(override.textContent).toBe(CARD_UI_CSS);
      expect(Reflect.get(override, CARD_UI_REFS_KEY)).toBe(1);
      expect(Reflect.get(override, CARD_UI_VERSION_KEY)).toBe(CARD_UI_CSS_VERSION);
      dispose();
      expect(removed).toBe(1);
    });

    it("旧样式存在时两次调用只补一份覆盖样式", () => {
      const old: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "old",
        remove: () => void 0,
      };
      Reflect.set(old, CARD_UI_REFS_KEY, 1);
      const { appended, removed, doc } = fakeDocument(old);
      const first = ensureCardUiCss(doc);
      const second = ensureCardUiCss(doc);
      expect(appended).toHaveLength(1);
      first();
      expect(removed).toStrictEqual([]);
      second();
      expect(removed).toStrictEqual([appended[0]]);
    });

    it("已有更高版本的覆盖样式时不回退内容", () => {
      const old: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "old",
        remove: () => void 0,
      };
      Reflect.set(old, CARD_UI_REFS_KEY, 1);
      const newer: FakeTag = {
        id: CARD_UI_OVERRIDE_STYLE_ID,
        textContent: "newer",
        remove: () => void 0,
      };
      Reflect.set(newer, CARD_UI_REFS_KEY, 1);
      Reflect.set(newer, CARD_UI_VERSION_KEY, CARD_UI_CSS_VERSION + 1);
      const { appended, doc } = fakeDocument(old, newer);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
      expect(newer.textContent).toBe("newer");
      dispose();
      expect(Reflect.get(newer, CARD_UI_REFS_KEY)).toBe(1);
    });

    it("覆盖样式已存在时升级到当前版本正文", () => {
      const old: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "old",
        remove: () => void 0,
      };
      Reflect.set(old, CARD_UI_REFS_KEY, 1);
      const override: FakeTag = {
        id: CARD_UI_OVERRIDE_STYLE_ID,
        textContent: "older-override",
        remove: () => void 0,
      };
      Reflect.set(override, CARD_UI_REFS_KEY, 1);
      Reflect.set(override, CARD_UI_VERSION_KEY, 0);
      const { appended, doc } = fakeDocument(old, override);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
      expect(override.textContent).toBe(CARD_UI_CSS);
      expect(Reflect.get(override, CARD_UI_VERSION_KEY)).toBe(CARD_UI_CSS_VERSION);
      dispose();
      expect(Reflect.get(override, CARD_UI_REFS_KEY)).toBe(1);
    });

    it("参数不是 document 形状时返回空操作", () => {
      const candidates: unknown[] = [
        "not-a-document",
        null,
        {},
        { querySelector: () => null, createElement: 1 },
        { querySelector: () => null, createElement: rejectCreate, head: null },
        { querySelector: () => null, createElement: rejectCreate, head: {} },
      ];
      for (const candidate of candidates) {
        expect(() => {
          ensureCardUiCss(candidate)();
        }).not.toThrow();
      }
    });

    it("没有 document 时返回空操作", () => {
      vi.stubGlobal("document", undefined);
      expect(() => {
        ensureCardUiCss()();
      }).not.toThrow();
    });

    it("全局 document 不是可注入形状时返回空操作", () => {
      vi.stubGlobal("document", {});
      expect(() => {
        ensureCardUiCss()();
      }).not.toThrow();
    });

    it("在真实 document 上只注入一份，最后一个引用释放后移除", () => {
      const first = ensureCardUiCss();
      const second = ensureCardUiCss();
      const tag = document.querySelector(`#${CARD_UI_STYLE_ID}`);
      expect(tag).not.toBeNull();
      expect(tag?.textContent).toBe(CARD_UI_CSS);
      first();
      expect(document.querySelector(`#${CARD_UI_STYLE_ID}`)).not.toBeNull();
      second();
      expect(document.querySelector(`#${CARD_UI_STYLE_ID}`)).toBeNull();
    });
  });

  describe("保存条底色", () => {
    it("基础规则显式铺面板底色，dirty 吸底时才铺半透明玻璃底", () => {
      expect(ruleBody(".dsu-savebar.dsu-savebar")).toContain(
        "background:var(--dsw-alias-card-fill)",
      );
      expect(ruleBody('.dsu-savebar.dsu-savebar[data-dirty="true"]')).toContain(
        "background:color-mix(",
      );
    });

    it("吸底底色是半透明 + 背景模糊，不是不透明主题色", () => {
      const dirty = ruleBody('.dsu-savebar.dsu-savebar[data-dirty="true"]');
      // 不透明底色只在「卡片背后正好是 bg-base」时成立；宿主「设置」对话框里插件分区叠在
      // bg-layer-2 上，写死 bg-base 就是一条比四周更暗的横带。设计稿的面板色是 card-fill。
      expect(dirty).not.toContain("var(--dsw-alias-bg-base)");
      // 不支持 color-mix 的 webview 上要有一条主题色兜底，不能退回全透明让内容穿过按钮。
      expect(dirty).toContain("background:var(--dsw-alias-card-fill);background:color-mix(");
      expect(dirty).toContain("backdrop-filter:blur(");
      expect(dirty).toContain("-webkit-backdrop-filter:blur(");
    });

    // 这两条是「旧一代 shared CSS 仍在页面上」的防线。设置卡的样式是跨来源拼起来的：
    // 装着旧版插件的客户端会把自己内联的那一代 `CARD_UI_CSS` 打到 head 末尾（id 由它自己起，
    // 「已经有 #dsh-card-ui-css 就跳过」的判定对它不生效），而同一批 class 名在那一代里带着
    // 不透明底色。选择器特异性同级、插入顺序又不可控，所以把 .dsu-savebar 的声明写成类名双写
    // ——特异性从 (0,1,0)/(0,2,0) 抬到 (0,2,0)/(0,3,0)，任何一代旧规则都压不住它。
    it("保存条两条规则都靠类名双写把特异性抬过旧一代", () => {
      expect(CARD_UI_CSS).toContain(".dsu-savebar.dsu-savebar{");
      expect(CARD_UI_CSS).toContain('.dsu-savebar.dsu-savebar[data-dirty="true"]{');
      // 旧写法（以 .dsu-savebar 单独开头的规则）必须彻底消失，否则它自己就成了一条会被
      // 旧规则压住的声明。注意 `.dsu-form .dsu-section>.dsu-savebar{…}` 那条间距规则不算：
      // 它管的是间距、不带底色，且同样特异性偏低无从竞争。
      expect(CARD_UI_CSS).not.toMatch(/^\.dsu-savebar\{/mu);
    });

    // 级联是按「属性」逐条比，不是按「规则」整块比：特异性更高的规则只要没声明 background，
    // 低特异性旧规则里的 background 就照样生效。所以基础规则必须显式写 background（v3 是
    // 面板底 var(--dsw-alias-card-fill)），不能靠「我不声明就没人声明」——旧一代的
    // `.dsu-savebar{…background:var(--dsw-alias-bg-base)}` 正好就是靠这一点在脏态之外
    // 也铺出底色（用户实测到的就是这一条）。
    it("基础规则显式声明底色，不靠「未声明」挡旧规则", () => {
      expect(ruleBody(".dsu-savebar.dsu-savebar")).toContain(
        "background:var(--dsw-alias-card-fill)",
      );
    });
  });
});
