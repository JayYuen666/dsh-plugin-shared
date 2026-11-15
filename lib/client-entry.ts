export const name = "@jayyuen66/dsh-plugin-shared";

/** 客户端行只提供组件与工具函数；这个入口只让 Cordis 客户端把行当作插件装载。 */
export function apply(): void {
  void 0;
}

export {
  CARD_UI_CSS,
  CARD_UI_STYLE_ID,
  CardForm,
  Field,
  FieldGrid,
  FieldLabel,
  InfoTip,
  ListField,
  NumberField,
  SaveBar,
  Section,
  SelectField,
  StatusBar,
  TextField,
  ToggleField,
  ensureCardUiCss,
  splitHint,
  useInvalidFields,
  withInvalidField,
} from "./card-ui.ts";
export type { FieldBase, InvalidFields, SelectOption } from "./card-ui.ts";
export { diffTouched } from "./card-diff.ts";
export { claimApply } from "./card-apply.ts";
export { fieldOf, isRecord } from "./record.ts";
export { errorText } from "./errors.ts";
export type { MessagesCatalog } from "./locale.ts";
