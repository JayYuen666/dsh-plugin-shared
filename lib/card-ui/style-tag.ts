import { CARD_UI_CSS } from "./styles.ts";

/** 统一设置卡样式在宿主文档里的固定 id。 */
export const CARD_UI_STYLE_ID = "dsh-card-ui-css";

/** 引用计数写在 style 元素自己身上。各插件的 client bundle 都内联了一份 shared，
 *  模块级变量不跨 bundle 共享；DOM 元素是唯一共享的判定面。 */
export const CARD_UI_REFS_KEY = Symbol.for("@jayyuen66/dsh-plugin-shared/card-ui-css/refs");

/** 本模块注入样式所需的 document 面。 */
export interface CardUiDocument {
  readonly querySelector: (selector: string) => unknown;
  readonly createElement: (tag: string) => CardUiStyleTag;
  readonly head: { readonly append: (node: CardUiStyleTag) => void };
}

/** 注入的 style 元素：只需要设 id 与正文，以及摘掉自己。 */
export interface CardUiStyleTag {
  id: string;
  textContent: string | null;
  remove: () => void;
}

interface RemovableStyle {
  readonly remove: () => void;
}

function noop(): void {
  // 没有可操作的 document，或这段样式不归本 helper 管。
}

function isCardUiDocument(value: unknown): value is CardUiDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const head: unknown = Reflect.get(value, "head");
  return (
    typeof Reflect.get(value, "querySelector") === "function" &&
    typeof Reflect.get(value, "createElement") === "function" &&
    typeof head === "object" &&
    head !== null &&
    typeof Reflect.get(head, "append") === "function"
  );
}

function activeDocument(doc: unknown): CardUiDocument | undefined {
  if (doc !== undefined) {
    return isCardUiDocument(doc) ? doc : undefined;
  }
  const candidate: unknown = typeof document === "undefined" ? undefined : document;
  return isCardUiDocument(candidate) ? candidate : undefined;
}

function isRemovableStyle(value: object): value is RemovableStyle {
  return typeof Reflect.get(value, "remove") === "function";
}

function refsOf(tag: object): number {
  const value: unknown = Reflect.get(tag, CARD_UI_REFS_KEY);
  return typeof value === "number" && value > 0 ? value : 0;
}

function createTag(doc: CardUiDocument): CardUiStyleTag {
  const tag = doc.createElement("style");
  tag.id = CARD_UI_STYLE_ID;
  tag.textContent = CARD_UI_CSS;
  doc.head.append(tag);
  return tag;
}

function makeDisposer(tag: RemovableStyle): () => void {
  let released = false;
  return (): void => {
    if (released) {
      return;
    }
    released = true;
    const refs = refsOf(tag);
    if (refs <= 1) {
      Reflect.deleteProperty(tag, CARD_UI_REFS_KEY);
      tag.remove();
      return;
    }
    Reflect.set(tag, CARD_UI_REFS_KEY, refs - 1);
  };
}

/**
 * 向文档注入统一的设置卡样式，重复调用只保留一个 style 元素。
 *
 * 为什么计数不在模块里：每个插件的 client bundle 都内联了一份 shared，模块级变量
 * 不跨 bundle 共享；style 元素本身才是所有副本都能看到的判定面。已有但没带计数的
 * style 元素不认领也不移除——它可能由另一份插件或旧版本注入，摘掉会让别人的卡片失去样式。
 *
 * @param doc - 宿主文档；缺省用全局 document，Node 环境下没有文档时返回空操作
 * @returns 释放本次引用；最后一个引用释放时移除 style 元素
 */
export function ensureCardUiCss(doc?: unknown): () => void {
  const target = activeDocument(doc);
  if (target === undefined) {
    return noop;
  }
  const existing = target.querySelector(`#${CARD_UI_STYLE_ID}`);
  if (existing !== null && existing !== undefined) {
    if (typeof existing !== "object" || !isRemovableStyle(existing)) {
      return noop;
    }
    const refs = refsOf(existing);
    if (refs === 0) {
      return noop;
    }
    Reflect.set(existing, CARD_UI_REFS_KEY, refs + 1);
    return makeDisposer(existing);
  }
  const tag = createTag(target);
  Reflect.set(tag, CARD_UI_REFS_KEY, 1);
  return makeDisposer(tag);
}
