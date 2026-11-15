// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_UI_CSS } from "../lib/card-ui/styles.ts";
import { CARD_UI_REFS_KEY, CARD_UI_STYLE_ID, ensureCardUiCss } from "../lib/card-ui/style-tag.ts";

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

function fakeDocument(existing: unknown = null): FakeState {
  const appended: FakeTag[] = [];
  const removed: FakeTag[] = [];
  const doc: FakeDocument = {
    querySelector: (selector: string): unknown => {
      if (selector === `#${CARD_UI_STYLE_ID}` && existing !== null) {
        return existing;
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

    it("已有未标记的同 id style 时不重复注入，也不在释放时移除", () => {
      const foreign: FakeTag = {
        id: CARD_UI_STYLE_ID,
        textContent: "already",
        remove: () => {
          throw new Error("不应移除别人的 style");
        },
      };
      const { appended, doc } = fakeDocument(foreign);
      const dispose = ensureCardUiCss(doc);
      expect(appended).toHaveLength(0);
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

    it("引用计数不是正整数时不认领该 style", () => {
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
      expect(appended).toHaveLength(0);
      expect(() => {
        dispose();
      }).not.toThrow();
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
    it("基础规则不铺底色，dirty 吸底时才铺", () => {
      expect(ruleBody(".dsu-savebar")).not.toContain("background");
      expect(ruleBody('.dsu-savebar[data-dirty="true"]')).toContain(
        "background:var(--dsw-alias-bg-base)",
      );
    });
  });
});
