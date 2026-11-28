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
  SectionToggle,
  Segmented,
  SecretField,
  SelectField,
  StatusBar,
  StatusDot,
  TextField,
  ToggleCell,
  ToggleField,
  ToggleGrid,
  ToolRow,
  ToolRowGrid,
  ToolRowItem,
  ensureCardUiCss,
  splitHint,
  useCardDraft,
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
  CardDraft,
  CardDraftOptions,
  ToolRowValueTone,
} from "./card-ui.ts";
export { diffTouched, formValueEquals } from "./card-diff.ts";
export { claimApply } from "./card-apply.ts";
export { arrayOf, fieldOf, hasOptionalMethods, isRecord } from "./record.ts";
export { asDisplayText, asText, escapeRegExp } from "./value.ts";
export { effectiveField, numberBoundsOf, withDraftField } from "./card-form.ts";
export type { NumberBounds, NumberBoundsFallback, NumberBoundsSchema } from "./card-form.ts";
export { errorText } from "./errors.ts";
export { raceTimeout } from "./with-timeout.ts";
export { clampInt } from "./number.ts";
export { parseOrThrow, remoteMounterOf } from "./typert-client.ts";
export type {
  RemoteHost,
  RemoteMounter,
  RemoteReaderContext,
  SafeParseFailure,
  SafeParseResult,
  SafeParseSuccess,
  SafeParser,
} from "./typert-client.ts";
export type { MessagesCatalog } from "./locale.ts";
