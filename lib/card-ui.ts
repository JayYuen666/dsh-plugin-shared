/** 设置卡统一组件与样式。客户端专用的子模块，不进入根 barrel。 */
export { CARD_UI_CSS } from "./card-ui/styles.ts";
export { CARD_UI_STYLE_ID, ensureCardUiCss } from "./card-ui/style-tag.ts";
export { splitHint } from "./card-ui/hint.ts";
export { withInvalidField, useInvalidFields } from "./card-ui/invalid.ts";
export { useCardDraft } from "./card-ui/draft.ts";
export type { CardDraft, CardDraftOptions } from "./card-ui/draft.ts";
export type { InvalidFields } from "./card-ui/invalid.ts";
export { CardForm, FieldGrid, FieldTwoCol, Section, StatusBar } from "./card-ui/layout.ts";
export { Field, FieldLabel, InfoTip } from "./card-ui/field.ts";
export type { FieldBase, TipPlacement } from "./card-ui/field.ts";
export {
  ListField,
  NumberField,
  SecretField,
  TextField,
  SectionToggle,
  ToggleCell,
  ToggleField,
  ToggleGrid,
} from "./card-ui/inputs.ts";
export { SelectField } from "./card-ui/select.ts";
export type { SelectOption } from "./card-ui/select.ts";
export { SaveBar } from "./card-ui/save-bar.ts";
export { Badge, StatusDot } from "./card-ui/badge.ts";
export type { BadgeTone, DotTone } from "./card-ui/badge.ts";
export { Callout } from "./card-ui/callout.ts";
export type { CalloutTone } from "./card-ui/callout.ts";
export { KpiGrid, KpiTile } from "./card-ui/stats.ts";
export type { KpiDelta } from "./card-ui/stats.ts";
export { DataTable, Meter } from "./card-ui/table.ts";
export type { DataTableColumn, DataTableRow, MeterTone } from "./card-ui/table.ts";
export { LogPanel } from "./card-ui/log-panel.ts";
export type { LogPanelAction } from "./card-ui/log-panel.ts";
export { Segmented } from "./card-ui/segmented.ts";
export type { SegmentedOption } from "./card-ui/segmented.ts";
export { EmptyState } from "./card-ui/empty.ts";
export { ToolRow, ToolRowGrid, ToolRowItem } from "./card-ui/tool-row.ts";
export type { ToolRowValueTone } from "./card-ui/tool-row.ts";
