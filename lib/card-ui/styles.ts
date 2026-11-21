/** 设置卡统一样式。颜色/圆角全部走宿主主题令牌。
 *
 *  v2 视觉层：字段行改为悬停起底（左右各 12px 内边距 + 等量负外边距，文字与高亮边缘留间距，
 *  去掉逐行分隔线）；焦点环改 3px 业务色；开关「开」态与主按钮用业务色（主按钮底色取宿主
 *  `--dsw-alias-button-primary-fill`，其上文字取 `--dsw-alias-label-primary-foreground`——
 *  这一对组合是宿主自己主按钮的写法）；保存条从顶部分隔线改成圆角面板。语义色淡底一律
 *  `color-mix(in srgb, var(--dsw-alias-state-*) N%, transparent)`，与宿主徽章/提示的写法同型，
 *  且避免写死十六进制色（`test/card-ui.test.ts` 有禁色断言）。 */
// 卡片内一律 border-box（见下方 `.dsu-form` 那条规则）。解释写在这里而不是 CSS 注释里：
// 这段模板字符串会原样进产物，CSS 注释也照样占字节，而 `test/dist-size.test.ts` 对
// 运行期切面有总预算。
// 根因：`.dsu-input` 是 `width:100%` + 左右各 12px padding + 1px 边框，浏览器默认
// `content-box` 会把它撑出容器 26px——实测 1280px 视口下右边缘 1258 > 容器 1232，
// 于是 MCP servers 的 textarea、ChatGPT 的输入框一路顶到卡片外的空白里。
// 写在 `.dsu-form` 的子孙上而不是只写 `.dsu-input`：各仓自己的 `.xxx-input` 一并受益；
// `::before`/`::after` 带上，免得伪元素造出的边框还按老尺寸算。
// 保存条规则写成 `.dsu-savebar.dsu-savebar` 是为了压过旧版插件内联的旧一代
// `.dsu-savebar{…background:var(--dsw-alias-bg-base)}`：旧样式由包内另一份
// `CARD_UI_CSS` 注入，覆盖不到「固定 id 已有就跳过」的判据，两份定义会在页面上同时存在。
// 类名重复不是冗余，删掉会把宿主设置对话框里的暗带带回来。它只压得住旧一代的单类选择器；
// 旧样式若写成 `.dsu-form .dsu-savebar`（同特异性）或带 `!important`，仍可能按插入顺序胜出。
// 吸底底色先写一条主题色兜底，再写 `color-mix`：不支持 `color-mix` 的 webview 上至少不会
// 退化成全透明，让滚动内容穿过按钮文字。

export const CARD_UI_CSS = `
.dsu-form{display:flex;flex-direction:column}
.dsu-form,.dsu-form *,.dsu-form *::before,.dsu-form *::after{box-sizing:border-box}
.dsu-section{margin-top:24px;padding-top:20px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsu-form .dsu-section>*+*{margin-top:10px}
.dsu-form .dsu-section>.dsu-sectionHint{margin-top:4px}
.dsu-form .dsu-section>*+.dsu-field{margin-top:0}
.dsu-form .dsu-section>.dsu-savebar{margin-top:24px}
.dsu-form>.dsu-section:first-child{margin-top:0;padding-top:0;border-top:0}
.dsu-sectionTitle{margin:0;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsu-sectionHead{display:flex;align-items:center;gap:8px;min-width:0}
.dsu-sectionActions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.dsu-sectionHint{margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-statusbar{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-field{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,360px);column-gap:32px;align-items:center;padding:10px 12px;margin:0 -12px;border-radius:var(--dsw-radius-md);transition:background-color .15s}
.dsu-field:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-fieldMeta{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsu-labelRow{display:flex;align-items:center;gap:6px;min-width:0}
.dsu-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsu-labelMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dsu-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-control{min-width:0;display:flex;align-items:center;gap:8px}
.dsu-fieldWide{grid-template-columns:minmax(0,1fr);align-items:start}
.dsu-fieldWide .dsu-control{width:100%;max-width:720px;margin-top:2px}
.dsu-help{display:inline-flex;align-items:center;gap:6px;min-width:0}
.dsu-helpBtn{appearance:none;border:0;background:transparent;padding:0;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:help;border-radius:50%;flex:none}
.dsu-help:hover .dsu-helpBtn,.dsu-helpBtn:focus-visible{color:var(--dsw-alias-state-business-primary)}
.dsu-helpBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-tip{width:max-content;position:fixed;position-area:block-end span-inline-end;justify-self:start;margin-top:8px;z-index:60;box-sizing:border-box;max-width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;overflow-wrap:anywhere;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);box-shadow:0 12px 32px rgb(0 0 0 / 45%);font-size:12px;line-height:1.6;font-weight:400;color:var(--dsw-alias-label-secondary)}
.dsu-input{width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsu-input:hover:not(:disabled):not([aria-invalid="true"]){border-color:var(--dsw-alias-border-l3)}
.dsu-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}
.dsu-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dsu-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dsu-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsu-textarea{height:auto;min-height:96px;padding:8px 12px;line-height:1.6;resize:vertical}
.dsu-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsu-numberWrap{display:flex;flex-direction:column;gap:4px;width:100%;min-width:0}
.dsu-number{position:relative;display:flex;align-items:center;gap:8px;min-width:0}
.dsu-number .dsu-input{min-width:0}
.dsu-number .dsu-input[type="number"]{appearance:textfield;-moz-appearance:textfield}
.dsu-number .dsu-input[type="number"]::-webkit-outer-spin-button,
.dsu-number .dsu-input[type="number"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.dsu-number .dsu-input.dsu-inputWithUnit{padding-right:32px}
.dsu-unit{position:absolute;right:9px;top:50%;transform:translateY(-50%);flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.dsu-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.dsu-switch{appearance:none;width:36px;height:20px;border-radius:999px;border:0;padding:2px;background:var(--dsw-alias-border-l3);display:flex;align-items:center;cursor:pointer;flex:none;transition:background-color .16s}
.dsu-knob{width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .16s,background-color .16s}
.dsu-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary)}
.dsu-switch[aria-checked="true"] .dsu-knob{transform:translateX(16px);background:var(--dsw-alias-label-primary-foreground)}
.dsu-switch:disabled{opacity:.4;cursor:not-allowed}
.dsu-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsu-selectWrap{position:relative;width:100%;min-width:0}
.dsu-select{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer}
.dsu-select[aria-expanded="true"]{border-color:var(--dsw-alias-state-business-primary)}
.dsu-selectValue{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsu-select[aria-expanded="true"] .dsu-chevron{transform:rotate(180deg)}
.dsu-menu{position:fixed;position-area:block-end span-inline-end;justify-self:start;margin-top:6px;z-index:70;padding:4px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;box-shadow:0 12px 32px rgb(0 0 0 / 50%);max-height:280px;overflow:auto}
.dsu-option{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.4;width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left}
.dsu-option:hover,.dsu-option[data-active="true"]{background:var(--dsw-alias-bg-layer-3)}
.dsu-option:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dsu-option:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsu-option[aria-selected="true"]{color:var(--dsw-alias-state-business-primary);font-weight:600}
.dsu-optionGroup{padding:6px 10px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dsu-check{opacity:0;flex:none}
.dsu-option[aria-selected="true"] .dsu-check{opacity:1}
.dsu-savebar.dsu-savebar{display:flex;align-items:center;gap:8px;padding:10px 14px;margin-top:24px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2)}
.dsu-savebar.dsu-savebar[data-dirty="true"]{position:sticky;bottom:0;z-index:2;background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,currentColor 8%,transparent);-webkit-backdrop-filter:blur(16px) saturate(130%);backdrop-filter:blur(16px) saturate(130%);box-shadow:0 -6px 16px rgb(0 0 0 / 22%)}
.dsu-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;border-radius:var(--dsw-radius-md);padding:5px 14px;cursor:pointer;transition:background-color .12s,border-color .12s,color .12s,filter .12s}
.dsu-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3)}
.dsu-btn:active:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dsu-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-btn:disabled{opacity:.4;cursor:not-allowed}
.dsu-btnSm{padding:2px 10px;font-size:12px}
.dsu-btnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.dsu-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:transparent;color:var(--dsw-alias-label-primary)}
.dsu-btnPrimary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsu-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}
.dsu-btnPrimary:active:not(:disabled){filter:brightness(.9)}
.dsu-btnDanger{color:var(--dsw-alias-state-error-primary)}
.dsu-btnDanger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}
.dsu-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsu-status{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-statusError{color:var(--dsw-alias-state-error-primary)}
.dsu-statusDirty{color:var(--dsw-alias-state-warn-primary)}
.dsu-dirtyPill{flex:none;font-size:11px;font-weight:600;border-radius:999px;padding:2px 10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary);white-space:nowrap}
.dsu-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;line-height:1.5;border-radius:999px;padding:2px 9px;white-space:nowrap}
.dsu-badgeNeutral{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2)}
.dsu-badgeBusiness{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsu-badgeOk{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsu-badgeWarn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dsu-badgeErr{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsu-dot{width:7px;height:7px;border-radius:999px;flex:none;display:inline-block}
.dsu-dotOk{background:var(--dsw-alias-state-success-primary)}
.dsu-dotWarn{background:var(--dsw-alias-state-warn-primary)}
.dsu-dotErr{background:var(--dsw-alias-state-error-primary)}
.dsu-dotMute{background:var(--dsw-alias-label-tertiary)}
.dsu-callout{display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:10px 14px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary)}
.dsu-calloutInfo{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);border-left:3px solid var(--dsw-alias-state-business-primary)}
.dsu-calloutOk{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);border-left:3px solid var(--dsw-alias-state-success-primary)}
.dsu-calloutWarn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);border-left:3px solid var(--dsw-alias-state-warn-primary)}
.dsu-calloutErr{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);border-left:3px solid var(--dsw-alias-state-error-primary)}
.dsu-calloutIcon{flex:none;width:16px;height:16px;border-radius:999px;display:grid;place-items:center;margin-top:1px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsu-calloutIconOk{background:var(--dsw-alias-state-success-primary)}
.dsu-calloutIconWarn{background:var(--dsw-alias-state-warn-primary)}
.dsu-calloutIconErr{background:var(--dsw-alias-state-error-primary)}
.dsu-kpiGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:10px;margin-top:8px}
.dsu-kpi{min-width:0;background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:12px 14px}
.dsu-kpiLabel{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsu-kpiValue{margin-top:3px;font-size:22px;font-weight:600;line-height:1.2;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dsu-kpiUnit{margin-left:2px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
.dsu-kpiSub{margin-top:3px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
@property --dsu-count-target{syntax:"<integer>";initial-value:0;inherits:false}
.dsu-kpiValue[data-count]{font-size:0;animation:dsu-count-up 620ms cubic-bezier(.22,.61,.36,1) forwards;counter-reset:dsu-count var(--dsu-count-target)}
.dsu-kpiValue[data-count]::after{content:counter(dsu-count) / "";font-size:22px;font-variant-numeric:tabular-nums}
@keyframes dsu-count-up{from{--dsu-count-target:0}}
@media (prefers-reduced-motion:reduce){.dsu-kpiValue[data-count]{animation-duration:1ms}}
.dsu-kpiDelta{display:inline-block;margin-top:5px;font-size:11px;font-weight:600;border-radius:999px;padding:1px 7px}
.dsu-kpiDeltaUp{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.dsu-kpiDeltaDown{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.dsu-tblWrap{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow-x:auto}
.dsu-tblScroll{max-height:420px;overflow:auto}
.dsu-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.dsu-tbl th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2);text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsu-tbl th.dsu-tblNum{text-align:right}
.dsu-tbl td{padding:9px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);vertical-align:middle}
.dsu-tbl tbody tr:last-child td{border-bottom:0}
.dsu-tbl tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-tblSticky th:first-child,.dsu-tblSticky td:first-child{position:sticky;left:0;z-index:1;width:1px;white-space:nowrap;background:var(--dsw-alias-bg-layer-2)}
.dsu-tblSticky thead th:first-child{z-index:3}
.dsu-tblSticky tbody td:first-child{box-shadow:inset -1px 0 0 var(--dsw-alias-border-l2)}
.dsu-tblSticky th:last-child,.dsu-tblSticky td:last-child{width:100%}
.dsu-tblEllip{display:block;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-tblTip{position:fixed;z-index:90;box-sizing:border-box;max-width:360px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);box-shadow:0 12px 32px rgb(0 0 0 / 45%);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:normal;overflow-wrap:anywhere;pointer-events:none}
.dsu-tblNum{text-align:right;font-variant-numeric:tabular-nums}
.dsu-tblId{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsu-tblMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.dsu-tblFoot{padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsu-meter{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dsu-meterTrack{flex:none;width:64px;height:6px;border-radius:999px;background:var(--dsw-alias-border-l2);overflow:hidden}
.dsu-meterFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}
.dsu-meterFillOk{background:var(--dsw-alias-state-success-primary)}
.dsu-meterFillWarn{background:var(--dsw-alias-state-warn-primary)}
.dsu-meterNum{flex:none;min-width:38px;text-align:right;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsu-log{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:color-mix(in srgb,black 22%,var(--dsw-alias-bg-layer-3))}
.dsu-logHead{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsu-logActions{margin-left:auto;display:flex;gap:2px}
.dsu-logAction{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;padding:2px 6px;border-radius:4px;cursor:pointer}
.dsu-logAction:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsu-logAction:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-logBody{margin:0;padding:11px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.dsu-logOk{color:var(--dsw-alias-state-success-primary)}
.dsu-logWarn{color:var(--dsw-alias-state-warn-primary)}
.dsu-logErr{color:var(--dsw-alias-state-error-primary)}
.dsu-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3)}
.dsu-segBtn{appearance:none;border:0;background:transparent;font:inherit;font-size:12.5px;font-weight:550;line-height:1.5;color:var(--dsw-alias-label-secondary);padding:5px 14px;border-radius:calc(var(--dsw-radius-md) - 2px);cursor:pointer;transition:background-color .15s,color .15s}
.dsu-segBtn:hover{color:var(--dsw-alias-label-primary)}
.dsu-segBtn[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsu-segBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-empty{border:.5px dashed var(--dsw-alias-border-l3);border-radius:10px;padding:24px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-emptyTitle{display:block;margin-bottom:2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsu-toolrow{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2);transition:border-color .15s}
.dsu-toolrow:hover{border-color:var(--dsw-alias-border-l3)}
.dsu-toolrowHead{display:flex;align-items:center;gap:8px;margin-bottom:8px;min-width:0}
.dsu-toolrowName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsu-toolrowPhase{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsu-toolrowKv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 16px;font-size:12px}
.dsu-toolrowKey{color:var(--dsw-alias-label-tertiary)}
.dsu-toolrowVal{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dsu-toolrowValOk{color:var(--dsw-alias-state-success-primary)}
.dsu-toolrowValWarn{color:var(--dsw-alias-state-warn-primary)}
.dsu-toolrowValErr{color:var(--dsw-alias-state-error-primary)}
.dsu-toolrowFoot{display:flex;justify-content:flex-end;margin-top:8px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsu-fieldCols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}
.dsu-fieldCols>.dsu-field{grid-template-columns:minmax(0,1fr);align-items:start;margin:0 -8px;padding:10px 8px}
.dsu-fieldCols>.dsu-field .dsu-control{margin-top:2px;max-width:none}
.dsu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:0 24px}
.dsu-grid>.dsu-field{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:10px 8px;margin:0 -8px;border-radius:var(--dsw-radius-md);transition:background-color .15s}
.dsu-grid>.dsu-field:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-grid>.dsu-field .dsu-control{width:100%}
@media (max-width:640px){
  .dsu-fieldCols{grid-template-columns:minmax(0,1fr)}
  .dsu-field{grid-template-columns:minmax(0,1fr);align-items:start;margin:0 -8px;padding:10px 8px}
  .dsu-control{width:100%;max-width:720px}
  .dsu-section{margin-top:20px;padding-top:20px}
}
@media (prefers-reduced-motion:reduce){
  .dsu-switch,.dsu-knob,.dsu-chevron,.dsu-btn,.dsu-field,.dsu-grid>.dsu-field,.dsu-segBtn,.dsu-toolrow{transition:none}
}
`;
