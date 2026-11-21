export const name = "@jayyuen66/dsh-plugin-shared";

/** 客户端行只提供组件与工具函数；这个入口只让 Cordis 客户端把行当作插件装载。 */
export function apply(): void {
  void 0;
}

export {
  CARD_UI_CSS,
  CARD_UI_STYLE_ID,
  Badge,
  Callout,
  CardForm,
  DataTable,
  EmptyState,
  Field,
  FieldGrid,
  FieldLabel,
  FieldTwoCol,
  InfoTip,
  KpiGrid,
  KpiTile,
  ListField,
  LogPanel,
  Meter,
  NumberField,
  SaveBar,
  Section,
  Segmented,
  SelectField,
  StatusBar,
  StatusDot,
  TextField,
  ToggleField,
  ToolRow,
  ToolRowGrid,
  ToolRowItem,
  ensureCardUiCss,
  splitHint,
  useInvalidFields,
  withInvalidField,
} from "./card-ui.ts";
export type {
  BadgeTone,
  CalloutTone,
  DataTableColumn,
  DataTableRow,
  DotTone,
  FieldBase,
  InvalidFields,
  KpiDelta,
  LogPanelAction,
  MeterTone,
  SegmentedOption,
  SelectOption,
  ToolRowValueTone,
} from "./card-ui.ts";
export { diffTouched } from "./card-diff.ts";
export { claimApply } from "./card-apply.ts";
export { fieldOf, isRecord } from "./record.ts";
export { errorText } from "./errors.ts";
export type { MessagesCatalog } from "./locale.ts";
