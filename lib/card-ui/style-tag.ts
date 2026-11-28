import { CARD_UI_CSS } from "./styles.ts";

/** 统一设置卡样式在宿主文档里的固定 id。 */
export const CARD_UI_STYLE_ID = "dsh-card-ui-css";

/** 旧版插件用固定 id 占住 `#dsh-card-ui-css` 时，当前版本的样式改注入这个 id。
 *  不替换旧元素：旧插件的 disposer 只摘自己那份，两代样式共存时由双类名选择器决定胜者。 */
export const CARD_UI_OVERRIDE_STYLE_ID = "dsh-card-ui-css-override";

/** 样式内容版本。`CARD_UI_CSS` 发生需要压过旧样式表的变化时递增；0 表示旧版未标记。 */
export const CARD_UI_CSS_VERSION = 3.1;

/** 版本写在 style 元素上，跨 bundle 共享；同一个 style 元素只保留最高版本的正文。 */
export const CARD_UI_VERSION_KEY = Symbol.for("@jayyuen66/dsh-plugin-shared/card-ui-css/version");

/** 引用计数写在 style 元素自己身上。消费方的 `client.js` 把 `@jayyuen66/dsh-plugin-shared/client`
 *  外置成宿主供应行，正常只有一份模块实例；但内联了自己那份 shared 的旧产物、或两代版本
 *  同时在场的页面，模块级变量并不共享——DOM 元素是唯一可靠的共享判定面。 */
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

function isStyleTag(value: unknown): value is CardUiStyleTag {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "remove") === "function"
  );
}

function versionOf(tag: object): number {
  const value: unknown = Reflect.get(tag, CARD_UI_VERSION_KEY);
  return typeof value === "number" && value > 0 ? value : 0;
}

function setVersion(tag: object, version: number): void {
  Reflect.set(tag, CARD_UI_VERSION_KEY, version);
}

function refsOf(tag: object): number {
  const value: unknown = Reflect.get(tag, CARD_UI_REFS_KEY);
  return typeof value === "number" && value > 0 ? value : 0;
}

function createTag(doc: CardUiDocument, id: string): CardUiStyleTag {
  const tag = doc.createElement("style");
  tag.id = id;
  tag.textContent = CARD_UI_CSS;
  doc.head.append(tag);
  return tag;
}

function makeDisposer(tag: CardUiStyleTag): () => void {
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

function retain(tag: CardUiStyleTag): () => void {
  const refs = refsOf(tag);
  if (refs === 0) {
    return noop;
  }
  Reflect.set(tag, CARD_UI_REFS_KEY, refs + 1);
  return makeDisposer(tag);
}

/**
 * 向文档注入统一的设置卡样式，重复调用只保留一个 style 元素。
 *
 * 为什么计数不在模块里：正常情况下消费方把 shared 外部化、由宿主模块表共用一份；但旧产物
 * 或特殊打包形态可能各自内联一份，模块级变量不跨 bundle 共享。style 元素本身才是所有副本
 * 都能看到的判定面。
 *
 * 旧版插件可能先占住固定 id `#dsh-card-ui-css`，而那一代 CSS 里还有不透明底色。
 * 所以已有同 id 元素时不能只看 id：版本低于当前就说明它是旧一代，当前版本要另注入一份
 * `#dsh-card-ui-css-override`，两代共存，靠样式里的双类名选择器压过旧规则。
 * 旧元素不认领也不移除——它可能由另一份插件或旧版本注入，摘掉会让别人的卡片失去样式。
 *
 * 覆盖样式带内容版本：任何一份新 bundle 只把正文升级到更高版本，不会被后来加载的
 * 旧版本 bundle 降级；引用计数仍然按 style 元素共享，最后一个引用释放时才移除。
 * `CARD_UI_CSS` 变化时必须同步递增 `CARD_UI_CSS_VERSION`，否则版本相同的旧正文会被当成当前版本。
 *
 * @param doc - 宿主文档；缺省用全局 document，Node 环境下没有文档时返回空操作
 * @returns 释放本次引用；最后一个引用释放时移除本 helper 管理的 style 元素
 */
export function ensureCardUiCss(doc?: unknown): () => void {
  const target = activeDocument(doc);
  if (target === undefined) {
    return noop;
  }
  const primary = target.querySelector(`#${CARD_UI_STYLE_ID}`);
  if (primary === null || primary === undefined) {
    const tag = createTag(target, CARD_UI_STYLE_ID);
    Reflect.set(tag, CARD_UI_REFS_KEY, 1);
    setVersion(tag, CARD_UI_CSS_VERSION);
    return makeDisposer(tag);
  }
  if (!isStyleTag(primary)) {
    return noop;
  }
  if (versionOf(primary) >= CARD_UI_CSS_VERSION) {
    // 页面上已经是当前或更高版本的样式：不回退，也不另插一份。
    return retain(primary);
  }
  const override = target.querySelector(`#${CARD_UI_OVERRIDE_STYLE_ID}`);
  if (override !== null && override !== undefined) {
    if (!isStyleTag(override)) {
      return noop;
    }
    if (versionOf(override) >= CARD_UI_CSS_VERSION) {
      return retain(override);
    }
    if (refsOf(override) === 0) {
      Reflect.set(override, CARD_UI_REFS_KEY, 1);
      Reflect.set(override, "textContent", CARD_UI_CSS);
      setVersion(override, CARD_UI_CSS_VERSION);
      return makeDisposer(override);
    }
    Reflect.set(override, "textContent", CARD_UI_CSS);
    setVersion(override, CARD_UI_CSS_VERSION);
    return retain(override);
  }
  const tag = createTag(target, CARD_UI_OVERRIDE_STYLE_ID);
  Reflect.set(tag, CARD_UI_REFS_KEY, 1);
  setVersion(tag, CARD_UI_CSS_VERSION);
  return makeDisposer(tag);
}
